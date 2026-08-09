import type { Toast } from "../app/workbench/types";

const directAction: Toast = {
  title: "导出没有完成",
  message: "请选择新的保存位置。",
  tone: "warning",
  disposition: "direct-action",
  action: { id: "retry-export", label: "重新选择位置" },
};

const userChoice: Toast = {
  title: "评论需要重新定位",
  message: "请选择新的位置。",
  tone: "warning",
  disposition: "user-choice",
  action: {
    id: "relink-target",
    label: "选择新位置",
    commentId: "comment-1",
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
  title: "评论需要重新定位",
  message: "请选择新的位置。",
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
