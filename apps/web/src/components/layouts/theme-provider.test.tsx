import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ThemeStyleProvider } from "./theme-provider";

describe("ThemeStyleProvider", () => {
  // Regression guard for the "double load": this provider wraps the entire app
  // directly under <body>. It used to render `null` until a `useLayoutEffect`
  // set a `mounted` flag, and because layout effects never run on the server
  // that emitted an empty <body> for every route — the browser painted a blank
  // document and then booted the whole tree client-side, which users saw as the
  // app loading twice. If this test ever fails, server-side rendering is
  // disabled app-wide again.
  test("renders its children in the server HTML", () => {
    const html = renderToStaticMarkup(
      <ThemeStyleProvider>
        <main>app shell</main>
      </ThemeStyleProvider>,
    );

    expect(html).toBe("<main>app shell</main>");
  });

  test("does not depend on browser globals to render", () => {
    // `document`/`localStorage` are absent in this environment, so a throw here
    // means the provider reintroduced a client-only render path.
    expect(() =>
      renderToStaticMarkup(
        <ThemeStyleProvider>
          <span>ok</span>
        </ThemeStyleProvider>,
      ),
    ).not.toThrow();
  });
});
