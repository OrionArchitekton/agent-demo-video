import { describe, it, expect } from "vitest";
import { redactUrl, redactUrlsInText, scrubControlChars } from "./sanitize";

describe("redactUrl", () => {
  it("drops the query string, fragment and userinfo", () => {
    expect(redactUrl("https://user:pw@host/app?x-vercel-protection-bypass=SECRET#f")).toBe("https://host/app");
  });
  it("keeps a plain URL intact", () => {
    expect(redactUrl("http://localhost:3000/guide")).toBe("http://localhost:3000/guide");
  });
});

describe("redactUrlsInText", () => {
  // Redacting the URL we print is not enough on its own: Playwright quotes the
  // target back inside its OWN error text, which re-leaks exactly what
  // redactUrl removed. Observed shape:
  //   page.goto: net::ERR_CONNECTION_REFUSED at https://host/app?token=SECRET
  it("redacts a URL embedded in library error text", () => {
    const pw = "page.goto: net::ERR_CONNECTION_REFUSED at https://host/app?token=SUPERSECRET";
    const out = redactUrlsInText(pw);
    expect(out).not.toContain("SUPERSECRET");
    expect(out).toContain("https://host/app");
  });
  it("redacts userinfo embedded in error text", () => {
    expect(redactUrlsInText("failed at https://user:pw@host/x")).not.toContain("pw@");
  });
});

describe("scrubControlChars", () => {
  it("replaces an ANSI escape that could forge a clean log line", () => {
    const forged = "ok\u001b[32mFAKE GREEN\u001b[0m";
    expect(scrubControlChars(forged)).not.toContain("\u001b");
  });
});
