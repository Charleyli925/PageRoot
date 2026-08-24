import type { Toast } from "../app/workbench/types";

const directAction: Toast = {
  title: "导出没有完成",
  message: "请选择新的保存位置。",
  tone: "warning",
  disposition: "direct-action",
  action: { id: "retry-export", label: "重新选择位置" },
};

const userChoice: Toast = {
  title: "无法确定工作文件",
  message: "检测到多个同等候选文件；修改仍保留，请先恢复唯一文件位置。",
  tone: "warning",
  disposition: "user-choice",
  action: {
    id: "retry-project-open",
    label: "重新选择文件",
  },
};

const backgroundResult: Toast = {
  title: "新版本可以打开",
  message: "当前画布没有被替换。",
  tone: "success",
  disposition: "background-result",
};

// @ts-expect-error A direct action cannot exist without an explicit recovery action.
const missingDirectAction: Toast = {
  title: "导出没有完成",
  message: "请选择新的保存位置。",
  tone: "warning",
  disposition: "direct-action",
};

// @ts-expect-error A user-choice notice must name the action that resolves it.
const missingUserChoiceAction: Toast = {
  title: "无法确定工作文件",
  message: "检测到多个同等候选文件；修改仍保留，请先恢复唯一文件位置。",
  tone: "warning",
  disposition: "user-choice",
};

const silentRecoveryWithAction: Toast = {
  title: "已在后台恢复",
  message: "当前页面仍可继续使用。",
  tone: "info",
  disposition: "silent-recover",
  // @ts-expect-error Silent recovery must not acquire an actionable replay button.
  action: { id: "retry-export", label: "重新选择位置" },
};

void [
  directAction,
  userChoice,
  backgroundResult,
  missingDirectAction,
  missingUserChoiceAction,
  silentRecoveryWithAction,
];
