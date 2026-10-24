using Microsoft.CodeAnalysis;

namespace GeminiLive.Analyzers;

/// <summary>
/// Every rule this project reports, each named after the TypeScript rule it mirrors so one
/// convention holds on both sides of the repo.
/// </summary>
internal static class Rules {
  private const string _category = "Style";

  /// <summary>no-nested-ternary (.oxlintrc.json).</summary>
  public static readonly DiagnosticDescriptor NoNestedTernary = new(
      "GL0001", "Do not nest conditional expressions",
      "Conditional expression nested in a conditional expression; use if/else or a named method",
      _category, DiagnosticSeverity.Warning, isEnabledByDefault: true);

  /// <summary>id-length, min 3 with the same exceptions (.oxlintrc.json).</summary>
  public static readonly DiagnosticDescriptor IdentifierLength = new(
      "GL0002", "Identifier name is too short",
      "Identifier '{0}' is shorter than {1} characters; name it in full words",
      _category, DiagnosticSeverity.Warning, isEnabledByDefault: true);

  /// <summary>@stylistic/max-len 120, ignoring strings and URLs (eslint.config.js).</summary>
  public static readonly DiagnosticDescriptor MaxLineLength = new(
      "GL0003", "Line is too long",
      "Line is {0} characters long; the limit is {1}",
      _category, DiagnosticSeverity.Warning, isEnabledByDefault: true);

  /// <summary>@stylistic/padding-line-between-statements around if (eslint.config.js).</summary>
  public static readonly DiagnosticDescriptor PaddingAroundIf = new(
      "GL0004", "Blank lines around if",
      "{0}",
      _category, DiagnosticSeverity.Warning, isEnabledByDefault: true);
}
