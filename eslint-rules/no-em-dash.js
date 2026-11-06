/**
 * Forbids the em dash (U+2014) anywhere in a file: code, strings, comments
 * and markup. CLAUDE.md: use a hyphen.
 */

const EM_DASH = /—/gu;

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      emDash: "Use a hyphen, not an em dash."
    }
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Program() {
        for (const match of sourceCode.text.matchAll(EM_DASH)) {
          const start = sourceCode.getLocFromIndex(match.index);
          const end = {
            line: start.line,
            column: start.column + 1
          };
          context.report({
            loc: {
              start,
              end
            },
            messageId: "emDash"
          });
        }
      }
    };
  }
};
