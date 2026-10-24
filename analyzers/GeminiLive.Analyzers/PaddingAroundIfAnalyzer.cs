using System.Collections.Generic;
using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace GeminiLive.Analyzers;

/// <summary>
/// The padding-line-between-statements rules for <c>if</c>, as eslint.config.js sets them: a blank
/// line before every <c>if</c>, except directly after a local declaration, where there is none; and
/// a blank line after every <c>if</c>. An <c>else if</c> is part of its <c>if</c>, not a statement.
/// </summary>
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class PaddingAroundIfAnalyzer : DiagnosticAnalyzer {
  /// <summary>The rule's id, for its code fix.</summary>
  public static string DiagnosticId => Rules.PaddingAroundIf.Id;

  /// <summary>The diagnostic property naming its <see cref="Fix"/> (PaddingAroundIfCodeFix reads it).</summary>
  public const string FixKey = "fix";

  /// <summary>What each diagnostic asks for, and so what its code fix does.</summary>
  public enum Fix { AddBefore, RemoveBefore, AddAfter }

  private static readonly ImmutableDictionary<Fix, string> _messages = new Dictionary<Fix, string> {
    [Fix.AddBefore] = "Put a blank line before this if",
    [Fix.RemoveBefore] = "No blank line between a local declaration and the if that follows it",
    [Fix.AddAfter] = "Put a blank line after this if",
  }.ToImmutableDictionary();

  public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics =>
      ImmutableArray.Create(Rules.PaddingAroundIf);

  public override void Initialize(AnalysisContext context) {
    context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
    context.EnableConcurrentExecution();
    context.RegisterSyntaxNodeAction(Analyze, SyntaxKind.IfStatement);
  }

  private static void Analyze(SyntaxNodeAnalysisContext context) {
    var statement = (IfStatementSyntax)context.Node;
    if (statement.Parent is not BlockSyntax and not SwitchSectionSyntax) {
      return;  // an else if, or a lone if as another statement's body
    }
    SyntaxList<StatementSyntax> siblings = statement.Parent is BlockSyntax block
        ? block.Statements
        : ((SwitchSectionSyntax)statement.Parent).Statements;
    int index = siblings.IndexOf(statement);
    if (index > 0) {
      CheckBefore(context, statement, siblings[index - 1]);
    }
    // A following if reports its own missing blank line; reporting it here too would fix it twice.
    if (index < siblings.Count - 1 && siblings[index + 1] is not IfStatementSyntax
        && !StartsWithBlankLine(siblings[index + 1])) {
      Report(context, statement.IfKeyword, Fix.AddAfter);
    }
  }

  private static void CheckBefore(SyntaxNodeAnalysisContext context, IfStatementSyntax statement,
                                  StatementSyntax previous) {
    bool blank = StartsWithBlankLine(statement);
    bool afterDeclaration = previous is LocalDeclarationStatementSyntax;
    if (afterDeclaration && blank) {
      Report(context, statement.IfKeyword, Fix.RemoveBefore);
    } else if (!afterDeclaration && !blank) {
      Report(context, statement.IfKeyword, Fix.AddBefore);
    }
  }

  // Whether an empty line separates the statement from the one before, comments between them
  // allowed. Leading trivia starts on the line after the previous statement, so a line end reached
  // with nothing but whitespace on its line closes an empty line.
  private static bool StartsWithBlankLine(StatementSyntax statement) {
    bool lineIsEmpty = true;
    foreach (SyntaxTrivia trivia in statement.GetLeadingTrivia()) {
      if (trivia.IsKind(SyntaxKind.EndOfLineTrivia)) {
        if (lineIsEmpty) {
          return true;
        }
        lineIsEmpty = true;
      } else if (!trivia.IsKind(SyntaxKind.WhitespaceTrivia)) {
        lineIsEmpty = false;
      }
    }
    return false;
  }

  private static void Report(SyntaxNodeAnalysisContext context, SyntaxToken token, Fix fix) {
    ImmutableDictionary<string, string?> properties =
        ImmutableDictionary<string, string?>.Empty.Add(FixKey, fix.ToString());
    context.ReportDiagnostic(Diagnostic.Create(
        Rules.PaddingAroundIf, token.GetLocation(), properties, _messages[fix]));
  }
}
