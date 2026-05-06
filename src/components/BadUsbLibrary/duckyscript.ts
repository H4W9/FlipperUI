import { completeFromList, snippetCompletion, type Completion } from "@codemirror/autocomplete";
import { StreamLanguage } from "@codemirror/language";
import type { StringStream } from "@codemirror/language";

const COMMANDS = new Set([
  "ALT",
  "BACKSPACE",
  "CAPSLOCK",
  "COMMAND",
  "CTRL",
  "CONTROL",
  "DELAY",
  "DELETE",
  "DOWN",
  "END",
  "ENTER",
  "ESC",
  "ESCAPE",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "GUI",
  "HOME",
  "INSERT",
  "LEFT",
  "MENU",
  "PAGEUP",
  "PAGEDOWN",
  "REM",
  "RIGHT",
  "SHIFT",
  "SPACE",
  "STRING",
  "TAB",
  "UP",
  "WINDOWS",
]);

export const duckyscriptLanguage = StreamLanguage.define<null>({
  name: "duckyscript",
  token(stream: StringStream) {
    if (stream.sol()) {
      const rest = stream.string.slice(stream.pos);
      if (/^\s*(REM\b|#)/i.test(rest)) {
        stream.skipToEnd();
        return "comment";
      }
    }

    if (stream.eatSpace()) return null;

    const word = stream.match(/[A-Za-z0-9_-]+/, false) as RegExpMatchArray | null;
    if (word?.[0]) {
      const upper = word[0].toUpperCase();
      stream.match(/[A-Za-z0-9_-]+/);
      if (COMMANDS.has(upper)) return "keyword";
      if (/^\d+$/.test(upper)) return "number";
      return "string";
    }

    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "REM" },
  },
});

const keywordCompletions: Completion[] = Array.from(COMMANDS)
  .sort()
  .map((label) => ({
    label,
    type: label === "REM" ? "text" : "keyword",
    boost: label === "STRING" || label === "DELAY" ? 5 : 0,
  }));

const snippetCompletions: Completion[] = [
  snippetCompletion("REM ${description}", {
    label: "rem",
    detail: "comment",
    type: "text",
  }),
  snippetCompletion("DELAY ${1000}", {
    label: "delay",
    detail: "pause in ms",
    type: "function",
    boost: 20,
  }),
  snippetCompletion("STRING ${text}", {
    label: "string",
    detail: "type text",
    type: "function",
    boost: 20,
  }),
  snippetCompletion("GUI r\nDELAY ${300}\nSTRING ${cmd}\nENTER", {
    label: "win-r",
    detail: "Windows Run command",
    type: "function",
    boost: 15,
  }),
  snippetCompletion("GUI SPACE\nDELAY ${300}\nSTRING ${terminal}\nENTER", {
    label: "mac-spotlight",
    detail: "macOS Spotlight launch",
    type: "function",
    boost: 15,
  }),
  snippetCompletion("CTRL ALT DELETE", {
    label: "ctrl-alt-delete",
    detail: "secure attention sequence",
    type: "function",
  }),
];

export const duckyscriptCompletionSource = completeFromList([
  ...snippetCompletions,
  ...keywordCompletions,
]);
