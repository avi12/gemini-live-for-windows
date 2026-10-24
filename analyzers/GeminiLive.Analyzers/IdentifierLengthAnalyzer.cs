using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace GeminiLive.Analyzers;

/// <summary>
/// Declared names are at least 3 characters, bar the same short names oxlint's id-length allows.
/// Like its <c>properties: "never"</c>, property names are exempt, record parameters included.
/// </summary>
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class IdentifierLengthAnalyzer : DiagnosticAnalyzer {
  private const int _minLength = 3;

  // = the id-length exceptions in .oxlintrc.json
  private static readonly ImmutableHashSet<string> _exceptions = ImmutableHashSet.Create(
      "z", "_", "i", "fs", "id", "os", "e", "db", "mi", "ui", "HL", "GL", "js", "q", "t", "to",
      "dd", "mm", "x", "y", "d", "T", "a", "fd", "n", "K", "V", "on", "gw", "hl", "gl", "FS", "fg",
      "km", "up", "ok", "R", "m", "h", "w", "s", "mo", "hM", "ml");

  public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics =>
      ImmutableArray.Create(Rules.IdentifierLength);

  public override void Initialize(AnalysisContext context) {
    context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
    context.EnableConcurrentExecution();
    context.RegisterSyntaxNodeAction(Analyze,
        SyntaxKind.VariableDeclarator, SyntaxKind.Parameter, SyntaxKind.SingleVariableDesignation,
        SyntaxKind.CatchDeclaration, SyntaxKind.ForEachStatement, SyntaxKind.LocalFunctionStatement,
        SyntaxKind.MethodDeclaration, SyntaxKind.ClassDeclaration, SyntaxKind.RecordDeclaration,
        SyntaxKind.StructDeclaration, SyntaxKind.InterfaceDeclaration, SyntaxKind.EnumDeclaration,
        SyntaxKind.TypeParameter);
  }

  private static void Analyze(SyntaxNodeAnalysisContext context) {
    SyntaxToken name = context.Node switch {
      VariableDeclaratorSyntax variable => variable.Identifier,
      ParameterSyntax parameter when !IsRecordProperty(parameter) => parameter.Identifier,
      SingleVariableDesignationSyntax designation => designation.Identifier,
      CatchDeclarationSyntax caught => caught.Identifier,
      ForEachStatementSyntax loop => loop.Identifier,
      LocalFunctionStatementSyntax function => function.Identifier,
      MethodDeclarationSyntax method => method.Identifier,
      BaseTypeDeclarationSyntax type => type.Identifier,
      TypeParameterSyntax typeParameter => typeParameter.Identifier,
      _ => default,
    };
    string text = name.ValueText;
    if (text.Length == 0 || text.Length >= _minLength || _exceptions.Contains(text)) {
      return;
    }
    context.ReportDiagnostic(
        Diagnostic.Create(Rules.IdentifierLength, name.GetLocation(), text, _minLength));
  }

  // A positional record's parameters are its properties.
  private static bool IsRecordProperty(ParameterSyntax parameter) {
    return parameter.Parent?.Parent is RecordDeclarationSyntax;
  }
}
