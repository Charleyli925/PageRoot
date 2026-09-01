window.confirm("Please continue with this unregistered prompt.");
dialog.showMessageBox({ type: "warning", message: "blocked" });
dialog.showErrorBox("unexpected title", "internal detail");
