import { describe, it, expect } from "vitest";
import { parseAcceptLanguage, defaultLanguagesFrom, validateLanguageInput } from "../worker/lib/languages.js";

describe("Accept-Language", () => {
  it("desteklenen dilleri q'ya göre sıralar, bölge kodunu atar, tekrarı birleştirir", () => {
    expect(parseAcceptLanguage("tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7,xx;q=0.6")).toEqual([
      { lang: "tr", q: 1 },
      { lang: "en", q: 0.8 },
    ]);
    expect(parseAcceptLanguage("de;q=0.5, en")).toEqual([{ lang: "en", q: 1 }, { lang: "de", q: 0.5 }]);
    expect(parseAcceptLanguage("en;q=0")).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
  });

  it("ilk dil rahat, diğerleri altyazılı; boşsa Türkçe", () => {
    expect(defaultLanguagesFrom("en-GB,de;q=0.7")).toEqual([
      { lang: "en", level: "fluent" },
      { lang: "de", level: "subtitles" },
    ]);
    expect(defaultLanguagesFrom("")).toEqual([{ lang: "tr", level: "fluent" }]);
  });
});

describe("dil girdisi doğrulama", () => {
  it("geçerli girdiyi tekilleştirir", () => {
    const r = validateLanguageInput([{ lang: "TR", level: "fluent" }, { lang: "en", level: "subtitles" }, { lang: "tr", level: "fluent" }]);
    expect(r.value).toEqual([{ lang: "tr", level: "fluent" }, { lang: "en", level: "subtitles" }]);
  });
  it("hatalı girdileri reddeder", () => {
    expect(validateLanguageInput("x").error).toBeTruthy();
    expect(validateLanguageInput([]).error).toBeTruthy();
    expect(validateLanguageInput([{ lang: "xx", level: "fluent" }]).error).toMatch(/Desteklenmeyen/);
    expect(validateLanguageInput([{ lang: "en", level: "bazen" }]).error).toMatch(/Geçersiz seviye/);
    expect(validateLanguageInput([{ lang: "en", level: "subtitles" }]).error).toMatch(/rahat/);
  });
});
