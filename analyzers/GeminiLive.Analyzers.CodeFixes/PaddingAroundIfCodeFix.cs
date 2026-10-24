using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Composition;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CodeActions;
using Microsoft.CodeAnalysis.CodeFixes;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Fix = GeminiLive.Analyzers.PaddingAroundIfAnalyzer.Fix;

namespace GeminiLive.Analyzers.CodeFixes;

/// <summary>Adds or removes the blank line GL0004 asks for, like ESLint's --fix does.</summary>
[ExportCodeFixProvider(LanguageNames.CSharp), Shared]
public sealed class PaddingAroundIfCodeFix : CodeFixProvider {
  private const string _title = "Fix the blank lines around if";

  public override ImmutableArray<string> FixableDiagnosticIds =>
      ImmutableArray.Create(PaddingAroundIfAnalyzer.DiagnosticId);

  public override FixAllProvider GetFixAllProvider() {
    return WellKnownFixAllProviders.BatchFixer;
  }

  public override async Task RegisterCodeFixesAsync(CodeFixContext context) {
    SyntaxNode? root = await context.Document.GetSyntaxRootAsync(context.CancellationToken)
        .ConfigureAwait(false);
    foreach (Diagnostic diagnostic in context.Diagnostics) {
      if (root?.FindToken(diagnostic.Location.SourceSpan.Start).Parent is not IfStatementSyntax ifStatement
          || !diagnostic.Properties.TryGetValue(PaddingAroundIfAnalyzer.FixKey, out string? name)
          || !Enum.TryParse(name, out Fix fix)) {
        continue;
      }
      context.RegisterCodeFix(
          CodeAction.Create(_title, token => Apply(context.Document, root, ifStatement, fix, token),
                            equivalenceKey: _title),
          diagnostic);
    }
  }

  private static Task<Document> Apply(Document document, SyntaxNode root, IfStatementSyntax ifStatement,
                                      Fix fix, CancellationToken cancellationToken) {
    cancellationToken.ThrowIfCancellationRequested();
    StatementSyntax target = fix == Fix.AddAfter ? NextStatement(ifStatement) ?? ifStatement : ifStatement;
    SyntaxTriviaList leading = target.GetLeadingTrivia();
    SyntaxTriviaList fixedTrivia = fix == Fix.RemoveBefore
        ? WithoutEmptyLines(leading)
        : leading.Insert(0, LineEnd(root));
    return Task.FromResult(document.WithSyntaxRoot(
        root.ReplaceNode(target, target.WithLeadingTrivia(fixedTrivia))));
  }

  private static StatementSyntax? NextStatement(IfStatementSyntax ifStatement) {
    SyntaxList<StatementSyntax> siblings = PaddingAroundIfAnalyzer.Siblings(ifStatement) ?? default;
    int index = siblings.IndexOf(ifStatement);
    return index >= 0 && index < siblings.Count - 1 ? siblings[index + 1] : null;
  }

  // The file's own line ending, so a fix never mixes CRLF and LF.
  private static SyntaxTrivia LineEnd(SyntaxNode root) {
    SyntaxTrivia existing = root.DescendantTrivia().FirstOrDefault(t => t.IsKind(SyntaxKind.EndOfLineTrivia));
    return existing.IsKind(SyntaxKind.EndOfLineTrivia) ? existing : SyntaxFactory.CarriageReturnLineFeed;
  }

  // Drops every line of the trivia that holds only whitespace, keeping comments and indentation.
  private static SyntaxTriviaList WithoutEmptyLines(SyntaxTriviaList trivia) {
    var kept = new List<SyntaxTrivia>();
    var line = new List<SyntaxTrivia>();
    foreach (SyntaxTrivia piece in trivia) {
      line.Add(piece);
      if (!piece.IsKind(SyntaxKind.EndOfLineTrivia)) {
        continue;
      }
      if (!line.All(t => t.IsKind(SyntaxKind.WhitespaceTrivia) || t.IsKind(SyntaxKind.EndOfLineTrivia))) {
        kept.AddRange(line);
      }
      line.Clear();
    }
    kept.AddRange(line);  // the statement's own indentation
    return SyntaxFactory.TriviaList(kept);
  }
}
