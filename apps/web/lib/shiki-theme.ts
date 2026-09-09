const functionColor = "var(--shiki-token-function)";
const parameterColor = "var(--shiki-token-parameter)";
const stringColor = "var(--shiki-token-string)";

const tokenColors = [
  {
    scope: ["comment", "punctuation.definition.comment", "string.comment"],
    settings: { foreground: "var(--shiki-token-comment)" },
  },
  {
    scope: [
      "constant",
      "entity.name.constant",
      "variable.other.constant",
      "variable.other.enummember",
      "variable.language",
      "entity",
    ],
    settings: { foreground: "var(--shiki-token-constant)" },
  },
  {
    scope: ["entity.name", "meta.export.default", "meta.definition.variable"],
    settings: { foreground: functionColor },
  },
  {
    scope: [
      "variable.parameter.function",
      "meta.jsx.children",
      "meta.block",
      "meta.tag.attributes",
      "entity.name.section",
      "text",
      "punctuation.definition.tag",
      "punctuation.separator.inheritance.php",
      "punctuation.definition.tag.html",
      "punctuation.definition.tag.begin.html",
      "punctuation.definition.tag.end.html",
      "punctuation.section.embedded",
      "variable.parameter",
    ],
    settings: { foreground: parameterColor },
  },
  {
    scope: ["entity.name.tag", "support.class.component"],
    settings: { foreground: functionColor },
  },
  {
    scope: ["keyword", "storage", "storage.type", "storage.modifier"],
    settings: { foreground: "var(--shiki-token-keyword)" },
  },
  {
    scope: [
      "string",
      "string punctuation.section.embedded source",
      "attribute.value",
    ],
    settings: { foreground: stringColor },
  },
  {
    scope: [
      "punctuation",
      "punctuation.definition.string",
      "punctuation.definition.variable",
      "punctuation.definition.string.begin",
      "punctuation.definition.string.end",
      "punctuation.section.embedded.begin",
      "punctuation.section.embedded.end",
    ],
    settings: { foreground: "var(--shiki-token-punctuation)" },
  },
  {
    scope: "string.regexp",
    settings: { foreground: "var(--shiki-token-string-expression)" },
  },
  {
    scope: [
      "support.function",
      "entity.name.function",
      "meta.function-call.generic",
    ],
    settings: { foreground: functionColor },
  },
  {
    scope: "markup.underline.link",
    settings: { foreground: "var(--shiki-token-link)" },
  },
  {
    scope: [
      "markup.list",
      "string.other.link.title.markdown",
      "string.other.link.description.markdown",
    ],
    settings: { foreground: parameterColor },
  },
];

export const geistShikiTheme = {
  colors: {
    "editor.background": "var(--shiki-color-background, transparent)",
    "editor.foreground": "var(--shiki-color-text, inherit)",
  },
  name: "geist",
  tokenColors,
  type: "dark",
} as const;
