/*
 * Tencent is pleased to support the open source community by making TMagicEditor available.
 *
 * Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { EventEmitter } from 'events';

import { Id } from '@tmagic/schema';

import { DEFAULT_ZOOM, GHOST_EL_ID_PREFIX } from './const';
import StageDragResize from './StageDragResize';
import StageHighlight from './StageHighlight';
import StageMask from './StageMask';
import StageRender from './StageRender';
import {
  CanSelect,
  GuidesEventData,
  RemoveData,
  Runtime,
  SortEventData,
  StageCoreConfig,
  UpdateData,
  UpdateEventData,
} from './types';
import { addSelectedClassName, removeSelectedClassName } from './util';

export default class StageCore extends EventEmitter {
  public selectedDom: Element | undefined;
  public highlightedDom: Element | undefined;

  public renderer: StageRender;
  public mask: StageMask;
  public dr: StageDragResize;
  public highlightLayer: StageHighlight;
  public config: StageCoreConfig;
  public zoom = DEFAULT_ZOOM;
  public container?: HTMLDivElement;
  private canSelect: CanSelect;

  constructor(config: StageCoreConfig) {
    super();

    this.config = config;

    this.setZoom(config.zoom);
    this.canSelect = config.canSelect || ((el: HTMLElement) => !!el.id);

    this.renderer = new StageRender({ core: this });
    this.mask = new StageMask({ core: this });
    this.dr = new StageDragResize({ core: this, container: this.mask.content });
    this.highlightLayer = new StageHighlight({ core: this, container: this.mask.wrapper });

    this.renderer.on('runtime-ready', (runtime: Runtime) => {
      this.emit('runtime-ready', runtime);
    });
    this.renderer.on('page-el-update', (el: HTMLElement) => {
      this.mask?.observe(el);
    });

    this.mask
      .on('beforeSelect', (event: MouseEvent) => {
        this.setElementFromPoint(event);
      })
      .on('select', () => {
        this.emit('select', this.selectedDom);
      })
      .on('changeGuides', (data: GuidesEventData) => {
        this.dr.setGuidelines(data.type, data.guides);
        this.emit('changeGuides', data);
      })
      .on('highlight', async (event: MouseEvent) => {
        await this.setElementFromPoint(event);
        if (this.highlightedDom === this.selectedDom) {
          this.highlightLayer.clearHighlight();
          return;
        }
        this.highlightLayer.highlight(this.highlightedDom as HTMLElement);
        this.emit('highlight', this.highlightedDom);
      })
      .on('clearHighlight', async () => {
        this.highlightLayer.clearHighlight();
      });

    // 要先触发select，在触发update
    this.dr
      .on('update', (data: UpdateEventData) => {
        setTimeout(() => this.emit('update', data));
      })
      .on('sort', (data: UpdateEventData) => {
        setTimeout(() => this.emit('sort', data));
      });
  }

  public async setElementFromPoint(event: MouseEvent) {
    const { renderer, zoom } = this;

    const doc = renderer.contentWindow?.document;
    let x = event.clientX;
    let y = event.clientY;

    if (renderer.iframe) {
      const rect = renderer.iframe.getClientRects()[0];
      if (rect) {
        x = x - rect.left;
        y = y - rect.top;
      }
    }

    const els = doc?.elementsFromPoint(x / zoom, y / zoom) as HTMLElement[];

    let stopped = false;
    const stop = () => (stopped = true);
    for (const el of els) {
      if (!el.id.startsWith(GHOST_EL_ID_PREFIX) && (await this.canSelect(el, event, stop))) {
        if (stopped) break;
        if (event.type === 'mousemove') {
          this.highlight(el);
          break;
        }
        this.select(el, event);
        break;
      }
    }
  }

  /**
   * 选中组件
   * @param idOrEl 组件Dom节点的id属性，或者Dom节点
   */
  public async select(idOrEl: Id | HTMLElement, event?: MouseEvent): Promise<void> {
    const el = await this.getTargetElement(idOrEl);

    if (el === this.selectedDom) return;

    const runtime = await this.renderer.getRuntime();

    await runtime?.select?.(el.id);

    if (runtime?.beforeSelect) {
      await runtime.beforeSelect(el);
    }

    this.mask.setLayout(el);
    this.dr.select(el, event);
    this.selectedDom = el;

    if (this.renderer.contentWindow) {
      removeSelectedClassName(this.renderer.contentWindow.document);
      if (this.selectedDom) {
        addSelectedClassName(this.selectedDom, this.renderer.contentWindow.document);
      }
    }
  }

  /**
   * 更新选中的节点
   * @param data 更新的数据
   */
  public update(data: UpdateData): Promise<void> {
    const { config } = data;

    return this.renderer?.getRuntime().then((runtime) => {
      runtime?.update?.(data);
      // 更新配置后，需要等组件渲染更新
      setTimeout(() => {
        const el = this.renderer.contentWindow?.document.getElementById(`${config.id}`);
        // 有可能dom已经重新渲染，不再是原来的dom了，所以这里判断id，而不是判断el === this.selectedDom
        if (el && el.id === this.selectedDom?.id) {
          this.selectedDom = el;
          // 更新了组件的布局，需要重新设置mask是否可以滚动
          this.mask.setLayout(el);
          this.dr.updateMoveable(el);
        }
      }, 0);
    });
  }

  /**
   * 高亮选中组件
   * @param el 页面Dom节点
   */
  public async highlight(idOrEl: HTMLElement | Id): Promise<void> {
    let el;
    try {
      el = await this.getTargetElement(idOrEl);
    } catch (error) {
      this.highlightLayer.clearHighlight();
      return;
    }
    if (el === this.highlightedDom) return;
    this.highlightLayer.highlight(el);
    this.highlightedDom = el;
  }

  public sortNode(data: SortEventData): Promise<void> {
    return this.renderer?.getRuntime().then((runtime) => runtime?.sortNode?.(data));
  }

  public add(data: UpdateData): Promise<void> {
    return this.renderer?.getRuntime().then((runtime) => runtime?.add?.(data));
  }

  public remove(data: RemoveData): Promise<void> {
    return this.renderer?.getRuntime().then((runtime) => runtime?.remove?.(data));
  }

  public setZoom(zoom: number = DEFAULT_ZOOM): void {
    this.zoom = zoom;
  }

  /**
   * 挂载Dom节点
   * @param el 将stage挂载到该Dom节点上
   */
  public mount(el: HTMLDivElement): void {
    this.container = el;
    const { mask, renderer } = this;

    renderer.mount(el);
    mask.mount(el);

    this.emit('mounted');
  }

  /**
   * 清空所有参考线
   */
  public clearGuides() {
    this.mask.clearGuides();
    this.dr.clearGuides();
  }

  /**
   * 销毁实例
   */
  public destroy(): void {
    const { mask, renderer, dr, highlightLayer } = this;

    renderer.destroy();
    mask.destroy();
    dr.destroy();
    highlightLayer.destroy();

    this.removeAllListeners();

    this.container = undefined;
  }

  private async getTargetElement(idOrEl: Id | HTMLElement): Promise<HTMLElement> {
    if (typeof idOrEl === 'string' || typeof idOrEl === 'number') {
      const el = this.renderer.contentWindow?.document.getElementById(`${idOrEl}`);
      if (!el) throw new Error(`不存在ID为${idOrEl}的元素`);
      return el;
    }
    return idOrEl;
  }
}
