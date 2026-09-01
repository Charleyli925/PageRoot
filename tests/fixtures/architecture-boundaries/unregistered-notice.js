setToast({
  title: "unregistered notice",
  message: "this must fail the freeze",
  tone: "info",
  disposition: "background-result",
});
const kind = "uncatalogued";
const notify = setToast;
notify({ title: "aliased" });
