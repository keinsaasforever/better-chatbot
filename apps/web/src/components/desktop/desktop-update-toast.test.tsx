// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { custom, dismiss } = vi.hoisted(() => ({
  custom: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { custom, dismiss } }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { render } from "@testing-library/react";
import { renderUpdateToast } from "./desktop-update-toast";

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${Object.values(values).join(",")}` : key;

function renderedToast() {
  const [factory] = custom.mock.calls[0]!;
  return render(factory());
}

describe("renderUpdateToast", () => {
  beforeEach(() => {
    custom.mockClear();
    dismiss.mockClear();
  });

  it("shows a persistent bottom-left toast when an update becomes available", () => {
    renderUpdateToast({ status: "available", version: "1.2.3" }, t, undefined);

    expect(custom).toHaveBeenCalledTimes(1);
    const [, options] = custom.mock.calls[0]!;
    expect(options).toMatchObject({
      id: "desktop-update",
      position: "bottom-left",
      duration: Number.POSITIVE_INFINITY,
    });
  });

  it("offers Restart now once a background download has finished", () => {
    const restartAndInstall = vi.fn().mockResolvedValue(undefined);
    const bridge = {
      getState: vi.fn(),
      downloadAndInstall: vi.fn(),
      restartAndInstall,
      onStateChange: vi.fn(),
    };
    renderUpdateToast({ status: "downloaded", version: "1.27.0" }, t, bridge);

    const view = renderedToast();
    expect(view.getByText("readyTitle:1.27.0")).toBeTruthy();
    view.getByTestId("desktop-update-restart").click();
    expect(restartAndInstall).toHaveBeenCalledTimes(1);
    view.getByText("later").click();
    expect(dismiss).toHaveBeenCalledWith("desktop-update");
  });

  it("keeps the click-to-download flow for desktop builds without background download", () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const bridge = {
      getState: vi.fn(),
      downloadAndInstall,
      onStateChange: vi.fn(),
    };
    renderUpdateToast({ status: "available", version: "1.26.0" }, t, bridge);

    const view = renderedToast();
    expect(view.getByText("legacyAvailableDescription:1.26.0")).toBeTruthy();
    view.getByText("updateNow").click();
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it("shows the error toast long enough to read", () => {
    renderUpdateToast(
      { status: "error", message: "network error" },
      t,
      undefined,
    );

    expect(custom).toHaveBeenCalledTimes(1);
    const [, options] = custom.mock.calls[0]!;
    expect(options).toMatchObject({
      id: "desktop-update",
      position: "bottom-left",
      duration: 15_000,
    });
  });

  it.each(["idle", "checking", "not-available"] as const)(
    "stays silent for %s state",
    (status) => {
      renderUpdateToast({ status }, t, undefined);
      expect(custom).not.toHaveBeenCalled();
    },
  );
});
