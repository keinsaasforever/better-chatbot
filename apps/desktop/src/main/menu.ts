import { Menu, type MenuItemConstructorOptions, app, shell } from "electron";
import { checkForUpdatesNow } from "./auto-updater.js";

export function createApplicationMenu(): void {
  const isMac = process.platform === "darwin";

  // Windows and Linux show an empty panel unless the fields are supplied, and
  // this is the only place either one reports the installed version: the
  // "about" role below lives in the macOS-only application menu.
  app.setAboutPanelOptions({
    applicationName: "Keinsaas Navigator",
    applicationVersion: app.getVersion(),
  });

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              {
                label: "Check for Updates…",
                click: () => {
                  void checkForUpdatesNow("manual");
                },
              },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        ...(isMac
          ? []
          : [
              {
                label: "About Keinsaas Navigator",
                click: () => {
                  app.showAboutPanel();
                },
              },
              { type: "separator" as const },
            ]),
        {
          label: "Documentation",
          click: () => {
            void shell.openExternal("https://docs.keinsaas.com");
          },
        },
        {
          label: "Check for Updates…",
          click: () => {
            void checkForUpdatesNow("manual");
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
