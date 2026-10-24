using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace GeminiLive.Analyzers;

/// <summary>A conditional expression may not be a branch of another (no-nested-ternary).</summary>
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class NoNestedTernaryAnalyzer : DiagnosticAnalyzer {
  public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics =>
      ImmutableArray.Create(Rules.NoNestedTernary);

  public override void Initialize(AnalysisContext context) {
    context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
    context.EnableConcurrentExecution();
    context.RegisterSyntaxNodeAction(Analyze, SyntaxKind.ConditionalExpression);
  }

  private static void Analyze(SyntaxNodeAnalysisContext context) {
    var conditional = (ConditionalExpressionSyntax)context.Node;
    foreach (ExpressionSyntax branch in new[] { conditional.WhenTrue, conditional.WhenFalse }) {
      if (Unwrap(branch) is ConditionalExpressionSyntax nested) {
        context.ReportDiagnostic(Diagnostic.Create(Rules.NoNestedTernary, nested.GetLocation()));
      }
    }
  }

  private static ExpressionSyntax Unwrap(ExpressionSyntax expression) {
    while (expression is ParenthesizedExpressionSyntax parenthesized) {
      expression = parenthesized.Expression;
    }
    return expression;
  }
}
