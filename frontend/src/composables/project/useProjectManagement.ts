import { ref, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGraphStore } from '@/stores/graphStore';
import { useProjectStore } from '@/stores/projectStore';

/**
 * @file useProjectManagement.ts
 * @description 项目管理组合式函数
 * 
 * 该模块提供项目管理功能的统一接口，包括项目的创建、打开、保存等操作。
 * 管理项目相关的对话框状态和表单数据。
 * 
 * 功能概述：
 * 1. 对话框管理 - 控制项目创建对话框的显示/隐藏
 * 2. 表单管理 - 管理新项目创建表单的数据
 * 3. 项目创建 - 验证表单数据并调用 store 创建项目
 * 4. 状态返回 - 向外部组件提供状态和操作方法
 * 
 * 架构设计：
 * - 使用 Vue 的响应式系统（ref、reactive）管理状态
 * - 封装项目管理相关的所有操作逻辑
 * - 通过返回值向外部提供状态和操作接口
 * 
 * 状态说明：
 * - showCreateDialog: 控制对话框显示的布尔值
 * - newProjectForm: 包含 name 和 path 的响应式表单对象
 * 
 * 方法说明：
 * - showProjectCreateDialog: 显示创建项目对话框
 * - handleCreateProject: 处理项目创建逻辑
 * 
 * 使用场景：
 * - NodeCanvas 组件的项目创建
 * - 项目管理界面的交互
 * 
 * 依赖说明：
 * - vue: 提供响应式系统
 * - vue-i18n: 国际化支持
 * - stores/graphStore: 项目数据状态管理
 */
export function useProjectManagement() {
  // 国际化支持
  const { t } = useI18n();
  // 获取全局图存储，用于访问和修改项目数据
  const store = useGraphStore();
  const projectStore = useProjectStore();

  // 控制项目创建对话框的显示状态
  // true 表示对话框可见，false 表示隐藏
  const showCreateDialog = ref(false);

  // 新项目表单数据，使用 reactive 确保响应式
  // name: 项目名称
  // path: 项目存储路径
  const newProjectForm = reactive({
    name: '',
    path: ''
  });

  /**
   * 显示项目创建对话框
   * 将对话框显示状态设置为 true
   * 供外部组件调用以触发对话框显示
   */
  const showProjectCreateDialog = () => {
    const configPath = projectStore.currentPaths?.configPath?.trim();
    if (configPath && !newProjectForm.path) {
      newProjectForm.path = configPath;
    }
    if (!newProjectForm.name) {
      newProjectForm.name = 'DefaultProject';
    }
    showCreateDialog.value = true;
  };

  /**
   * 处理项目创建
   * 验证表单数据有效性，如果有效则调用 store 创建项目
   * 创建成功后关闭对话框并重置表单
   */
  const handleCreateProject = () => {
    // 验证表单数据：项目名称和路径都不能为空
    if (newProjectForm.name && newProjectForm.path) {
      // 调用 store 方法创建项目
      store.createProject(newProjectForm.name, newProjectForm.path);
      
      // 关闭对话框
      showCreateDialog.value = false;

      // 重置表单数据，准备下一次创建
      newProjectForm.name = '';
      newProjectForm.path = '';
    }
    // 如果表单数据不完整，不执行任何操作
  };

  // 返回响应式状态和操作方法，供外部组件使用
  return {
    showCreateDialog,
    newProjectForm,
    showProjectCreateDialog,
    handleCreateProject
  };
}
