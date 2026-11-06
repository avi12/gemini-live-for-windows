// The pill's code rules (pill/**), adapted from winui-svelte's google-style.js and the
// youtube-time-manager CLAUDE.md. Logic and correctness stay in oxlint (.oxlintrc.json); this
// carries what oxlint cannot: selector bans, naming and the local custom rules.

// A compound or comparing `if` condition is extracted into a named boolean. An `else if`
// condition stays inline, because hoisting it above the first branch changes short-circuiting.
const conditionIsNotElseIf = "IfStatement[parent.type!='IfStatement']";

export const pillSyntax = [
  {
    selector: `${conditionIsNotElseIf} > LogicalExpression.test`,
    message: "Extract the condition into a descriptively-named const (is/has/can/should) right before the if."
  },
  {
    selector: `${conditionIsNotElseIf} > BinaryExpression.test`,
    message: "Extract the comparison into a descriptively-named const (is/has/can/should) right before the if."
  },
  {
    selector: "ConditionalExpression > LogicalExpression.test",
    message: "Extract the ternary's condition into a descriptively-named const (is/has/can/should)."
  },
  {
    selector: "CallExpression[callee.property.name='forEach']",
    message: "Use for...of instead of .forEach."
  },
  {
    selector: ":matches(CallExpression[callee.property.name='reduce'], CallExpression[callee.property.name='reduceRight'])",
    message: "Use a plain for loop instead of .reduce."
  },
  {
    selector: ":matches(FunctionDeclaration, TSDeclareFunction)[params.length>1]",
    message: "A function with 2+ parameters takes one destructured object parameter."
  },
  {
    selector: "MethodDefinition[kind!='constructor'] > FunctionExpression[params.length>1]",
    message: "A method with 2+ parameters takes one destructured object parameter."
  },
  {
    selector: ":matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression)[returnType]:not([returnType.typeAnnotation.type='TSTypePredicate'])",
    message: "Do not write a return type: let TypeScript infer it."
  },
  {
    selector: "TSEnumDeclaration",
    message: "Use an `as const` object and a union type instead of an enum."
  }
];

// Importing a module does no work: a statement at the top of a module, other than a
// declaration, is work done on import.
export const treeShakingSyntax = [
  {
    selector: "Program > ExpressionStatement[directive=undefined]",
    message: "Importing a module must do no work: move this inside a function the caller runs."
  },
  {
    selector: "Program > :matches(IfStatement, ForStatement, ForOfStatement, WhileStatement, TryStatement, SwitchStatement)",
    message: "Importing a module must do no work: move this inside a function the caller runs."
  }
];

// Named exports only; a .svelte file's default export is Svelte's own and is never written.
export const pillRules = {
  "no-restricted-exports": ["error", {
    restrictDefaultExports: {
      direct: true,
      named: true,
      defaultFrom: true,
      namedFrom: true,
      namespaceFrom: true
    }
  }],
  // `@/` over `../`; `./` stays.
  "no-restricted-imports": ["error", {
    patterns: [
      {
        group: ["../*"],
        message: "Import through @/ instead of a parent-relative ../ path."
      }
    ]
  }],
  "@typescript-eslint/ban-ts-comment": ["error", {
    "ts-ignore": true,
    "ts-nocheck": true,
    "ts-check": false,
    "ts-expect-error": "allow-with-description",
    minimumDescriptionLength: 10
  }],
  "@typescript-eslint/consistent-type-imports": ["error", {
    prefer: "type-imports",
    fixStyle: "separate-type-imports"
  }],
  "@typescript-eslint/no-non-null-assertion": "error",
  "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
  "no-nested-ternary": "error",
  "@typescript-eslint/no-explicit-any": "error",
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-var": "error",
  "@typescript-eslint/prefer-for-of": "error",
  "@typescript-eslint/only-throw-error": "error",
  "@typescript-eslint/no-namespace": "error",
  "@typescript-eslint/no-require-imports": "error",
  "@typescript-eslint/no-wrapper-object-types": "error",
  "@typescript-eslint/no-unsafe-function-type": "error",
  "@typescript-eslint/no-empty-object-type": "error",
  "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
  "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
  "@typescript-eslint/explicit-member-accessibility": ["error", { accessibility: "no-public" }],
  "@typescript-eslint/no-magic-numbers": ["error", {
    ignore: [0, 1, -1, 2],
    ignoreEnums: true,
    ignoreReadonlyClassProperties: true,
    ignoreNumericLiteralTypes: true,
    ignoreTypeIndexes: true,
    enforceConst: true
  }],
  "no-else-return": ["error", { allowElseIf: false }],
  "no-lonely-if": "error",
  "max-depth": ["error", 3],
  "max-nested-callbacks": ["error", 3],
  "local/no-em-dash": "error"
};

// Rules that read type information (the typescript-eslint project service).
// Module constants of a plain value are SCREAMING_SNAKE_CASE. Only .ts files get this: a .svelte
// file's instance script is "global" to the parser, where a const is a plain local.
const moduleConstantNaming = [
  {
    selector: "variable",
    modifiers: ["const", "global"],
    types: ["boolean"],
    format: ["UPPER_CASE"],
    custom: {
      regex: "^(IS|HAS|CAN|SHOULD)_",
      match: true
    }
  },
  {
    selector: "variable",
    modifiers: ["const", "global"],
    types: ["string", "number"],
    format: ["UPPER_CASE"]
  }
];

const sharedNaming = [
  {
    // Booleans read as is/has/can/should and are phrased positively
    selector: ["variable", "parameter", "classProperty", "parameterProperty"],
    types: ["boolean"],
    format: ["PascalCase"],
    prefix: ["is", "has", "can", "should"],
    custom: {
      regex: "^(is|has|can|should)(Not|No|Disabled|Hidden|Invisible|Missing|Unavailable)",
      match: false
    }
  },
  {
    selector: "variable",
    modifiers: ["const", "global"],
    format: ["camelCase", "UPPER_CASE", "PascalCase"]
  },
  {
    selector: "variable",
    format: ["camelCase"]
  },
  {
    selector: "parameter",
    format: ["camelCase"],
    leadingUnderscore: "allow"
  },
  {
    selector: "function",
    format: ["camelCase"]
  },
  {
    selector: [
      "classProperty",
      "classMethod",
      "accessor",
      "parameterProperty",
      "typeProperty",
      "objectLiteralProperty",
      "objectLiteralMethod"
    ],
    format: ["camelCase", "UPPER_CASE"],
    leadingUnderscore: "forbid"
  },
  {
    // Names an external shape dictates (a quoted key, an HTTP header)
    selector: ["objectLiteralProperty", "typeProperty", "classProperty"],
    modifiers: ["requiresQuotes"],
    format: null
  },
  {
    selector: "interface",
    format: ["PascalCase"],
    custom: {
      regex: "^I[A-Z]",
      match: false
    }
  },
  {
    selector: ["class", "typeAlias", "typeParameter"],
    format: ["PascalCase"]
  }
];

export const pillTypeAwareRules = {
  "@typescript-eslint/no-for-in-array": "error",
  "@typescript-eslint/naming-convention": ["error", ...moduleConstantNaming, ...sharedNaming]
};

export const pillSvelteTypeAwareRules = {
  "@typescript-eslint/no-for-in-array": "error",
  "@typescript-eslint/naming-convention": ["error", ...sharedNaming]
};
