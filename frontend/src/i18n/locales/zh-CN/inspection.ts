/**
 * @file inspection.ts
 * @description 配置自检 — 中文翻译
 */
const inspection = {
  title: '配置自检',
  badge: {
    tooltip: '配置存在 {count} 个问题',
    ignoredTooltip: '{count} 个问题已忽略，点击查看',
  },
  severity: {
    blocker: '阻塞',
    warning: '警告',
    info: '提示',
  },
  summary: {
    issuesTitle: '发现 {count} 个问题',
    passedTitle: '配置检查通过',
    allClear: '项目配置一切正常',
    lastCheck: '检查于 {time}',
  },
  empty: {
    passedTitle: '配置完全正确',
    passedDesc: '项目配置未发现任何问题，可以放心使用。',
    allIgnoredTitle: '所有问题都已忽略',
    allIgnoredDesc: '当前共 {count} 个问题被忽略，可点击下方按钮恢复查看。',
  },
  groupBy: {
    file: '按文件',
    severity: '按严重度',
  },
  action: {
    recheck: '重新检查',
    expandAll: '全部展开',
    manageIgnored: '管理忽略项',
    copyAll: '复制全部',
    dismiss: '忽略此问题',
    dismissShort: '忽略',
    dismissAllInGroup: '忽略该组所有问题',
    dismissAllShort: '忽略全部',
    restore: '恢复',
    openFile: '打开文件',
  },
  /**
   * 卡片上的动作按钮文案（与后端 action.label_key 对应）
   */
  actions: {
    openFile: '打开文件',
    copyFilePath: '复制文件路径',
    copyId: '复制 ID',
    dismiss: '忽略',
    viewAvailableTables: '查看可用表',
    selectFix: '选择',
    navigateToNode: '定位到节点',
    autoFix: {
      deduplicate: '一键去重',
    },
  },
  context: {
    availableSchemas: '项目中可用的表（点击可直接修正引用）',
    availableColumns: '可用的列（点击可直接修正引用）',
  },
  rawDetails: '查看原始信息',
  errorType: '错误类型',
  filePath: '文件路径',
  copyAll: {
    file: '文件',
    refId: '资源 ID',
  },
  unknownFile: '（未知文件）',
  errors: {
    noProject: '未设置项目路径',
    noFixApi: '该问题暂不支持自动修复',
    nodeNotFound: '未找到目标节点',
  },
  toast: {
    recheckDone: '检查完成，发现 {count} 个问题',
    recheckFailed: '重新检查失败',
    copied: '已复制到剪贴板',
    pathCopied: '已复制文件路径',
    allCopied: '已复制 {count} 个问题为 Markdown',
    nothingToCopy: '没有可复制的问题',
    fixDone: '修复完成',
    fixFailed: '修复失败',
  },
  ignoredManager: {
    title: '管理已忽略的问题',
    empty: '暂无被忽略的问题',
    clearAll: '清空所有忽略',
  },
  /**
   * 各类配置问题的本地化文案
   * 占位符与后端 message_params 对应：
   *   - manifestId / fileId / filePath / manifestDisplay / fileDisplay（ID 不一致）
   *   - constraintId / tableId / columnId（外键 / 通用引用）
   */
  issues: {
    idMismatch: {
      schema: {
        title: '表 ID 与项目清单对不上',
        description:
          '项目清单里登记的表 ID 是「{manifestDisplay}」，但实际文件里的表 ID 是「{fileDisplay}」。这可能会导致其他引用到这张表的地方失效。',
        fixHint: '把项目清单里的 ID 改成与文件一致，或反过来修改文件里的 ID。',
      },
      constraint: {
        title: '约束 ID 与项目清单对不上',
        description:
          '项目清单里登记的约束 ID 是「{manifestDisplay}」，但实际文件里的约束 ID 是「{fileDisplay}」。这可能让这条规则无法被正确引用。',
        fixHint: '把项目清单里的 ID 改成与文件一致，或反过来修改文件里的 ID。',
      },
      regex: {
        title: '正则规则 ID 与项目清单对不上',
        description:
          '项目清单里登记的正则规则 ID 是「{manifestDisplay}」，但实际文件里的 ID 是「{fileDisplay}」。这可能让这条规则无法被正确引用。',
        fixHint: '把项目清单里的 ID 改成与文件一致，或反过来修改文件里的 ID。',
      },
      transform: {
        title: '数据转换 ID 与项目清单对不上',
        description:
          '项目清单里登记的数据转换 ID 是「{manifestDisplay}」，但实际文件里的 ID 是「{fileDisplay}」。这可能让这个转换无法被正确引用。',
        fixHint: '把项目清单里的 ID 改成与文件一致，或反过来修改文件里的 ID。',
      },
    },
    dupConstraintRef: {
      title: '同一个约束被引用了多次',
      description:
        '项目清单里同一个约束文件「{filePath}」被列了两次，其中一条登记的 ID「{manifestDisplay}」与文件里的实际 ID「{fileDisplay}」对不上。这会让这条规则被加载两次，可能产生冲突。',
      fixHint: '点击「一键修正」自动清理（推荐），或手动从项目清单里删掉多余的那一条。',
    },
    fk: {
      srcTableMissing: {
        title: '找不到外键来源的表',
        description:
          '外键规则「{constraintId}」要从来源表「{tableId}」取数据进行匹配，但这张表已不在项目里（可能被删除或重命名）。',
        fixHint: '从下方"项目中可用的表"挑一张作为来源表，点击即可自动修正。',
      },
      srcColMissing: {
        title: '找不到外键来源的列',
        description:
          '外键规则「{constraintId}」要从来源表「{tableId}」的「{columnId}」列取数据，但这一列已不存在。',
        fixHint: '从下方"可用的列"挑一个作为来源列，点击即可自动修正。',
      },
      dstTableMissing: {
        title: '找不到外键关联的目标表',
        description:
          '外键规则「{constraintId}」要关联到目标表「{tableId}」，但这张表已不在项目里（可能被删除或重命名）。',
        fixHint: '从下方"项目中可用的表"挑一张作为目标表，点击即可自动修正。',
      },
      dstColMissing: {
        title: '找不到外键关联的列',
        description:
          '外键规则「{constraintId}」要关联到目标表「{tableId}」的「{columnId}」列，但这一列已不存在。',
        fixHint: '从下方"可用的列"挑一个作为目标列，点击即可自动修正。',
      },
    },
    ref: {
      tableMissing: {
        title: '规则关联的表已不存在',
        description:
          '规则「{constraintId}」要关联到表「{tableId}」，但这张表已不在项目里（可能被删除或重命名）。',
        fixHint: '从下方"项目中可用的表"挑一张作为关联的表，点击即可自动修正。',
      },
      colMissing: {
        title: '规则关联的列已不存在',
        description:
          '规则「{constraintId}」要关联到表「{tableId}」的「{columnId}」列，但这一列已不存在。',
        fixHint: '从下方"可用的列"挑一个作为关联的列，点击即可自动修正。',
      },
    },
    regex: {
      tableMissing: {
        title: '正则规则关联的表已不存在',
        description:
          '正则规则「{constraintId}」要关联到表「{tableId}」，但这张表已不在项目里（可能被删除或重命名）。',
        fixHint: '从下方"项目中可用的表"挑一张作为关联的表，点击即可自动修正。',
      },
      colMissing: {
        title: '正则规则关联的列已不存在',
        description:
          '正则规则「{constraintId}」要关联到表「{tableId}」的「{columnId}」列，但这一列已不存在。',
        fixHint: '从下方"可用的列"挑一个作为关联的列，点击即可自动修正。',
      },
    },
    saveBlocked: {
      title: '保存被阻塞',
      description: '{description}',
      fixHint: '请检查画布中的节点配置',
      fixHintWithField: '请检查节点 {nodeId} 的 {field} 字段',
    },
  },
}

export default inspection
