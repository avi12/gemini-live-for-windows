using System.Collections.Immutable;
using System.Linq;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Text;

namespace GeminiLive.Analyzers;

/// <summary>
/// Lines stay within 120 characters. As with ESLint's max-len options, a line holding a string
/// literal or a URL is exempt: breaking those up only makes them harder to search for.
/// </summary>
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class MaxLineLengthAnalyzer : DiagnosticAnalyzer {
  private const int _maxLength = 120;
  private const string _url = "://";

  public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics =>
      ImmutableArray.Create(Rules.MaxLineLength);

  public override void Initialize(AnalysisContext context) {
    context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
    context.EnableConcurrentExecution();
    context.RegisterSyntaxTreeAction(Analyze);
  }

  private static void Analyze(SyntaxTreeAnalysisContext context) {
    SyntaxNode root = context.Tree.GetRoot(context.CancellationToken);
    SourceText text = context.Tree.GetText(context.CancellationToken);
    foreach (TextLine line in text.Lines) {
      int length = line.Span.Length;
      if (length <= _maxLength || line.ToString().Contains(_url) || HoldsString(root, line.Span)) {
        continue;
      }
      context.ReportDiagnostic(Diagnostic.Create(
          Rules.MaxLineLength, Location.Create(context.Tree, line.Span), length));
    }
  }

  private static bool HoldsString(SyntaxNode root, TextSpan span) {
    return root.DescendantTokens(span).Any(token => token.IsKind(SyntaxKind.StringLiteralToken)
        || token.IsKind(SyntaxKind.InterpolatedStringTextToken)
        || token.IsKind(SyntaxKind.Utf8StringLiteralToken)
        || token.IsKind(SyntaxKind.InterpolatedStringStartToken)
        || token.IsKind(SyntaxKind.MultiLineRawStringLiteralToken)
        || token.IsKind(SyntaxKind.SingleLineRawStringLiteralToken));
  }
}
