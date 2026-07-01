/**
 * @file inspection.ts
 * @description 配置自检 — 中文翻译
 */
const inspection = {
  title: '配置自检',
  badge: {
    tooltip: '配置存在 {count} 个问题',
    ignoredTooltip: '{count} 个问题已忽略，点击查看',
    passedTooltip: '配置检查通过，未发现问题',
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
    availableSchemas: '选择一张表替换',
    availableColumns: '选择一列替换',
  },
  /** 当引用项的 id 是机器生成的（UUID/编码）时，用来替代原始 id 的中性称谓 */
  machineIdLabel: {
    table: '一张已删除的表',
    column: '一列已删除的列',
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
    nodeNotFound: '该节点尚未在画布上，可从左侧资源树把它拖入后再定位',
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
    /** title 完全缺失时的兜底文案 */
    untitled: '配置存在问题',
    /** ID 不一致：项目配置里记录的名字和文件里的名字对不上 */
    idMismatch: {
      schema: {
        title: '数据表的名字对不上',
        description:
          '项目配置里记的表名是「{fileDisplay}」，但这个表文件里的名字是「{manifestDisplay}」。两边不一致，可能导致别的规则找不到这张表。',
        fixHint: '点「一键修正」让两边名字统一即可。',
      },
      constraint: {
        title: '规则的名字对不上',
        description:
          '项目配置里记的规则名是「{fileDisplay}」，但规则文件里的名字是「{manifestDisplay}」。两边不一致，这条规则可能无法生效。',
        fixHint: '点「一键修正」让两边名字统一即可。',
      },
      regex: {
        title: '正则规则的名字对不上',
        description:
          '项目配置里记的正则名是「{fileDisplay}」，但规则文件里的名字是「{manifestDisplay}」。两边不一致，这条规则可能无法生效。',
        fixHint: '点「一键修正」让两边名字统一即可。',
      },
      transform: {
        title: '数据转换的名字对不上',
        description:
          '项目配置里记的转换名是「{fileDisplay}」，但文件里的名字是「{manifestDisplay}」。两边不一致，这个转换可能无法生效。',
        fixHint: '点「一键修正」让两边名字统一即可。',
      },
    },
    /** 同一条规则在项目配置里被重复登记 */
    dupConstraintRef: {
      title: '同一条规则被重复登记',
      description:
        '规则文件「{filePath}」在项目配置里出现了两次，其中一次的名字（{manifestDisplay}）和文件里的（{fileDisplay}）还不一样。重复登记会让这条规则冲突。',
      fixHint: '点「一键修正」自动去掉多余的那一条即可。',
    },
    /** 外键规则引用的表/列找不到 */
    fk: {
      srcTableMissing: {
        title: '外键要取数的表找不到了',
        description: '{constraintDisplay}要从表「{tableId}」取数，但这张表可能已被删除或改名。',
        fixHint: '点选下方一张现有的表作为来源即可。',
      },
      srcColMissing: {
        title: '外键要取数的列找不到了',
        description:
          '{constraintDisplay}要从表「{tableId}」的「{columnId}」列取数，但这一列已不存在。',
        fixHint: '点选下方一个现有的列作为来源即可。',
      },
      dstTableMissing: {
        title: '外键要关联的表找不到了',
        description: '{constraintDisplay}要关联到表「{tableId}」，但这张表可能已被删除或改名。',
        fixHint: '点选下方一张现有的表作为目标即可。',
      },
      dstColMissing: {
        title: '外键要关联的列找不到了',
        description:
          '{constraintDisplay}要关联到表「{tableId}」的「{columnId}」列，但这一列已不存在。',
        fixHint: '点选下方一个现有的列作为目标即可。',
      },
    },
    /** 普通规则引用的表/列找不到 */
    ref: {
      tableMissing: {
        title: '规则要用的表找不到了',
        description: '{constraintDisplay}要用到表「{tableId}」，但这张表可能已被删除或改名。',
        fixHint: '点选下方一张现有的表即可。',
      },
      colMissing: {
        title: '规则要用的列找不到了',
        description:
          '{constraintDisplay}要用到表「{tableId}」的「{columnId}」列，但这一列已不存在。',
        fixHint: '点选下方一个现有的列即可。',
      },
    },
    /** 正则规则引用的表/列找不到 */
    regex: {
      tableMissing: {
        title: '正则规则要用的表找不到了',
        description: '{regexDisplay}要用到表「{tableId}」，但这张表可能已被删除或改名。',
        fixHint: '点选下方一张现有的表即可。',
      },
      colMissing: {
        title: '正则规则要用的列找不到了',
        description: '{regexDisplay}要用到表「{tableId}」的「{columnId}」列，但这一列已不存在。',
        fixHint: '点选下方一个现有的列即可。',
      },
    },
    saveBlocked: {
      title: '暂时无法保存',
      description: '{description}',
      fixHint: '请检查画布中的节点配置',
      fixHintWithField: '请检查节点 {nodeId} 的 {field} 字段',
    },
    /**
     * 加载期错误（文件不存在 / 解析失败 / 路径问题 / 模板展开失败）
     * 占位符：resourceLabel（资源类型中文名）、refId（引用编号）、filename（文件名）、instanceId（模板实例编号）
     */
    load: {
      pathValidation: {
        title: '{resourceLabel}的文件路径有问题',
        description:
          '项目配置里指向「{resourceLabel}」（{refId}）的路径无法访问，可能写错了，或指向了项目目录之外。',
        fixHint: '请检查该资源的路径，确保它指向项目目录内的文件。',
      },
      notFound: {
        title: '{resourceLabel}文件找不到了',
        description:
          '项目配置里引用的「{resourceLabel}」（{refId}）对应的文件「{filename}」不存在，可能被移动、删除或改名了。',
        fixHint: '请确认文件是否还在，或从项目配置中移除这条失效的引用。',
      },
      parseError: {
        title: '{resourceLabel}文件内容格式有误',
        description:
          '「{resourceLabel}」（{refId}）的文件无法按格式解析，通常是 YAML 语法写错或缺少必要字段。',
        fixHint: '请打开文件检查缩进和必填字段，可参考同类型的其他配置文件。',
      },
      templateExpansion: {
        title: '模板无法展开',
        description:
          '画布上的模板（{instanceId}）展开成具体规则时出错了，可能是参数没填全，或模板定义有问题。',
        fixHint: '请检查模板参数是否完整、引用的列/表是否存在，必要时删掉重新创建。',
      },
    },
    /** 多张表用了同一个表名 */
    schemaIdDuplicate: {
      title: '有表重名了',
      description:
        '表名「{schemaId}」被 {count} 张表同时使用。别的规则按名字找表时会搞混，每张表的名字应保持唯一。',
      fixHint: '给其中一张表换个不重复的名字即可（点「定位到节点」可跳转修改）。',
    },
    /** 多张表指向同一个数据文件 */
    sourceDuplicate: {
      title: '有表指向了同一个数据文件',
      description:
        '数据文件「{sourceDisplay}」被 {count} 张表同时定义（{schemas}）。一个数据文件只能由一张表定义，否则读取会冲突。',
      fixHint: '只保留其中一张表，删掉或修改其余的（点「定位到节点」可跳转处理）。',
    },
  },
}

export default inspection
