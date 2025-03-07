<template>
  <framework :code-options="codeOptions">
    <template #nav>
      <slot name="nav" :editorService="editorService"><nav-menu :data="menu"></nav-menu></slot>
    </template>

    <template #sidebar>
      <slot name="sidebar" :editorService="editorService">
        <sidebar :data="sidebar"></sidebar>
      </slot>
    </template>

    <template #workspace :editorService="editorService">
      <slot name="workspace">
        <workspace
          :runtime-url="runtimeUrl"
          :render="render"
          :moveable-options="moveableOptions"
          :can-select="canSelect"
        >
          <template #workspace-content><slot name="workspace-content" :editorService="editorService"></slot></template>
          <template #page-bar-title="{ page }"><slot name="page-bar-title" :page="page"></slot></template>
          <template #page-bar-popover="{ page }"><slot name="page-bar-popover" :page="page"></slot></template>
        </workspace>
      </slot>
    </template>

    <template #propsPanel>
      <slot name="propsPanel">
        <props-panel ref="propsPanel" @mounted="(instance) => $emit('props-panel-mounted', instance)"></props-panel>
      </slot>
    </template>

    <template #empty><slot name="empty" :editorService="editorService"></slot></template>
  </framework>
</template>

<script lang="ts">
import { defineComponent, onUnmounted, PropType, provide, toRaw, watch } from 'vue';

import { EventOption } from '@tmagic/core';
import type { FormConfig } from '@tmagic/form';
import type { MApp, MNode } from '@tmagic/schema';
import type StageCore from '@tmagic/stage';
import type { MoveableOptions } from '@tmagic/stage';

import Framework from '@editor/layouts/Framework.vue';
import NavMenu from '@editor/layouts/NavMenu.vue';
import PropsPanel from '@editor/layouts/PropsPanel.vue';
import Sidebar from '@editor/layouts/sidebar/Sidebar.vue';
import Workspace from '@editor/layouts/workspace/Workspace.vue';
import componentListService from '@editor/services/componentList';
import editorService from '@editor/services/editor';
import eventsService from '@editor/services/events';
import historyService from '@editor/services/history';
import propsService from '@editor/services/props';
import uiService from '@editor/services/ui';
import type { ComponentGroup, MenuBarData, Services, SideBarData, StageRect } from '@editor/type';

export default defineComponent({
  name: 'm-editor',

  components: {
    NavMenu,
    Sidebar,
    Workspace,
    PropsPanel,
    Framework,
  },

  props: {
    /** 页面初始值 */
    modelValue: {
      type: Object as PropType<MApp>,
      default: () => ({}),
      require: true,
    },

    /** 左侧面板中的组件列表 */
    componentGroupList: {
      type: Array as PropType<ComponentGroup[]>,
      default: () => [],
    },

    /** 左侧面板配置 */
    sidebar: {
      type: Object as PropType<SideBarData>,
    },

    /** 顶部工具栏配置 */
    menu: {
      type: Object as PropType<MenuBarData>,
      default: () => ({ left: [], right: [] }),
    },

    /** 中间工作区域中画布渲染的内容 */
    render: {
      type: Function as PropType<() => HTMLDivElement>,
    },

    /** 中间工作区域中画布通过iframe渲染时的页面url */
    runtimeUrl: String,

    /** 组件的属性配置表单的dsl */
    propsConfigs: {
      type: Object as PropType<Record<string, FormConfig>>,
      default: () => ({}),
    },

    /** 添加组件时的默认值 */
    propsValues: {
      type: Object as PropType<Record<string, MNode>>,
      default: () => ({}),
    },

    /** 组件联动事件选项列表 */
    eventMethodList: {
      type: Object,
      default: () => ({}),
    },

    /** 画布中组件选中框的移动范围 */
    moveableOptions: {
      type: [Object, Function] as PropType<MoveableOptions | ((core?: StageCore) => MoveableOptions)>,
    },

    /** 编辑器初始化时默认选中的组件ID */
    defaultSelected: {
      type: [Number, String],
    },

    canSelect: {
      type: Function as PropType<(el: HTMLElement) => boolean | Promise<boolean>>,
    },

    stageRect: {
      type: [String, Object] as PropType<StageRect>,
    },

    codeOptions: {
      type: Object,
      default: () => ({}),
    },
  },

  emits: ['props-panel-mounted', 'update:modelValue'],

  setup(props, { emit }) {
    editorService.on('root-change', () => {
      const node = editorService.get<MNode | null>('node') || props.defaultSelected;
      node && editorService.select(node);
      emit('update:modelValue', toRaw(editorService.get('root')));
    });

    // 初始值变化，重新设置节点信息
    watch(
      () => props.modelValue,
      (modelValue) => editorService.set('root', modelValue),
      {
        immediate: true,
      },
    );

    watch(
      () => props.componentGroupList,
      (componentGroupList) => componentListService.setList(componentGroupList),
      {
        immediate: true,
      },
    );

    watch(
      () => props.propsConfigs,
      (configs) => propsService.setPropsConfigs(configs),
      {
        immediate: true,
      },
    );

    watch(
      () => props.propsValues,
      (values) => propsService.setPropsValues(values),
      {
        immediate: true,
      },
    );

    watch(
      () => props.eventMethodList,
      (eventMethodList) => {
        const eventsList: Record<string, EventOption[]> = {};
        const methodsList: Record<string, EventOption[]> = {};

        Object.keys(eventMethodList).forEach((type: string) => {
          eventsList[type] = eventMethodList[type].events;
          methodsList[type] = eventMethodList[type].methods;
        });

        eventsService.setEvents(eventsList);
        eventsService.setMethods(methodsList);
      },
      {
        immediate: true,
      },
    );

    watch(
      () => props.defaultSelected,
      (defaultSelected) => defaultSelected && editorService.select(defaultSelected),
      {
        immediate: true,
      },
    );

    watch(
      () => props.stageRect,
      (stageRect) => stageRect && uiService.set('stageRect', stageRect),
      {
        immediate: true,
      },
    );

    onUnmounted(() => editorService.destroy());

    const services: Services = {
      componentListService,
      eventsService,
      historyService,
      propsService,
      editorService,
      uiService,
    };

    provide('services', services);

    return services;
  },
});
</script>
