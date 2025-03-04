import { CodeAction, CodeActionKind, Command, Diagnostic, Position, Range, WorkspaceEdit, TextEdit, SymbolTag } from "vscode-languageserver-types";
import * as typedb from "./database";
import * as scriptfiles from "./as_parser";
import * as scriptsymbols from "./symbols";

class CodeActionContext
{
    range_start : number;
    range_end : number;

    module : scriptfiles.ASModule;
    scope : scriptfiles.ASScope;
    statement : scriptfiles.ASStatement;

    diagnostics : Array<Diagnostic>;
    actions : Array<CodeAction>;
};

export function GetCodeActions(asmodule : scriptfiles.ASModule, range : Range, diagnostics : Array<Diagnostic>) : Array<CodeAction>
{
    let context = new CodeActionContext();
    context.module = asmodule;
    context.actions = new Array<CodeAction>();
    context.range_start = asmodule.getOffset(Position.create(range.start.line, 0));
    context.range_end = asmodule.getOffset(Position.create(range.end.line, 10000));
    context.scope = asmodule.getScopeAt(context.range_start);
    context.statement = asmodule.getStatementAt(context.range_start);
    context.diagnostics = diagnostics;

    // Actions for adding missing imports
    AddImportActions(context);

    // Actions for autos
    AddAutoActions(context);

    // Actions for members
    AddMemberActions(context);

    // Actions for generating delegate bind functions
    AddGenerateDelegateFunctionActions(context);

    // Actions for method override snippets
    AddMethodOverrideSnippets(context);

    // Actions for adding casts
    AddCastHelpers(context);

    // Actions for adding super calls
    AddSuperCallHelper(context);

    // Actions for promoting to member variables
    AddVariablePromotionHelper(context);

    // Actions for switch blocks
    AddSwitchCaseActions(context);

    return context.actions;
}

export function ResolveCodeAction(asmodule : scriptfiles.ASModule, action : CodeAction, data : any) : CodeAction
{
    if (data.type == "import")
        ResolveImportAction(asmodule, action, data);
    else if (data.type == "delegateBind")
        ResolveGenerateDelegateFunctionAction(asmodule, action, data);
    else if (data.type == "methodOverride")
        ResolveMethodOverrideSnippet(asmodule, action, data);
    else if (data.type == "addCast")
        ResolveCastHelper(asmodule, action, data);
    else if (data.type == "superCall")
        ResolveSuperCallHelper(asmodule, action, data);
    else if (data.type == "materializeAuto")
        ResolveAutoAction(asmodule, action, data);
    else if (data.type == "variablePromotion")
        ResolveVariablePromotionHelper(asmodule, action, data);
    else if (data.type == "insertMacro")
        ResolveInsertMacro(asmodule, action, data);
    else if (data.type == "insertCases")
        ResolveInsertCases(asmodule, action, data);
    return action;
}

function AddImportActions(context : CodeActionContext)
{
    for (let symbol of context.module.symbols)
    {
        if (!symbol.isUnimported)
            continue;
        if (!symbol.overlapsRange(context.range_start, context.range_end))
            continue;

        let appliedTo = new Array<Diagnostic>();
        for (let diag of context.diagnostics)
        {
            if (diag.data)
            {
                let data = diag.data as any;
                if (data.type && data.type == "import")
                {
                    if (data.symbol[0] == symbol.type
                        && data.symbol[1] == symbol.container_type
                        && data.symbol[2] == symbol.symbol_name)
                    {
                        appliedTo.push(diag);
                    }
                }
            }
        }

        let symbolDisplayName = symbol.symbol_name;
        if (symbolDisplayName.startsWith("__"))
            symbolDisplayName = symbolDisplayName.substr(2);

        context.actions.push(<CodeAction> {
            kind: CodeActionKind.QuickFix,
            title: "Import "+symbolDisplayName,
            source: "angelscript",
            diagnostics: appliedTo,
            isPreferred: true,
            data: {
                uri: context.module.uri,
                type: "import",
                symbol: symbol,
            }
        });
    }
}

function ResolveImportAction(asmodule : scriptfiles.ASModule, action : CodeAction, data : any)
{
    let definitions = scriptsymbols.GetSymbolDefinition(asmodule, data.symbol);
    if (!definitions || definitions.length == 0)
        return action;

    let moduleName = definitions[0].module.modulename;
    if (asmodule.isModuleImported(moduleName))
        return action;

    // Find the first line to insert on
    let lastImportLine = 0;

    // Find if the module is already imported, or the position to append the new import
    let lineCount = asmodule.textDocument.lineCount;
    let hasEmptyLine = false;
    let alreadyImported = false;
    let importRegex = /\s*import\s+([A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*);/;

    for(let i = 0; i < lineCount; ++i)
    {
        let line = asmodule.textDocument.getText(
            Range.create(Position.create(i, 0), Position.create(i, 10000))
        );

        let match = importRegex.exec(line);
        if (match)
        {
            if (match[1] == moduleName)
            {
                alreadyImported = true;
                break;
            }

            lastImportLine = i + 1;
            hasEmptyLine = false;
        }
        else if (line.trim().length != 0)
        {
            // Break if we find a line that's not empty, signalling the end of the import-block
            break;
        }
        else
        {
            hasEmptyLine = true;
        }
    }

    action.edit = <WorkspaceEdit> {};
    action.edit.changes = {};
    if (alreadyImported)
        return;

    let insertString = "import "+moduleName+";\n";
    if (!hasEmptyLine)
        insertString += "\n";

    action.edit.changes[asmodule.displayUri] = [
        TextEdit.insert(Position.create(lastImportLine, 0), insertString)
    ];
}

function AddGenerateDelegateFunctionActions(context : CodeActionContext)
{
    for (let diag of context.diagnostics)
    {
        let data = diag.data as any;
        if (data && data.type == "delegateBind")
        {
            context.actions.push(<CodeAction> {
                kind: CodeActionKind.QuickFix,
                title: "Generate Method: "+data.name+"()",
                source: "angelscript",
                diagnostics: [diag],
                isPreferred: true,
                data: {
                    uri: context.module.uri,
                    type: "delegateBind",
                    delegate: data.delegate,
                    name: data.name,
                    position: diag.range.start,
                }
            });
        }
    }
}

function ResolveGenerateDelegateFunctionAction(asmodule : scriptfiles.ASModule, action : CodeAction, data : any)
{
    let delegateType = typedb.GetType(data.delegate);
    if (!delegateType)
        return;

    let [insertPosition, indent, prefix, suffix] = FindInsertPositionForGeneratedMethod(asmodule, data.position);
    let snippet = prefix;
    snippet += indent+"UFUNCTION()\n";
    snippet += GenerateMethodHeaderString("private ", indent, data.name, delegateType.delegateReturn, delegateType.delegateArgs);
    snippet += "\n";
    snippet += indent+"{\n";
    snippet += indent+"}\n";
    snippet += suffix;

    action.edit = <WorkspaceEdit> {};
    action.edit.changes = {};
    action.edit.changes[asmodule.displayUri] = [
        TextEdit.insert(insertPosition, snippet)
    ];
}

function GenerateMethodHeaderString(prefix : string, indent : string, name : string, returnType : string, args : Array<typedb.DBArg>) : string
{
    let snippet = indent+prefix;
    let preambleLength = name.length + 2 + prefix.length;
    if (returnType)
    {
        snippet += returnType;
        preambleLength += returnType.length;
    }
    else
    {
        snippet += "void";
        preambleLength += 4;
    }

    snippet += " ";
    snippet += name;
    snippet += "(";

    let lineLength = preambleLength + indent.length;
    if (args)
    {
        for (let i = 0; i < args.length; ++i)
        {
            let arg = args[i];
            let argLength = arg.typename.length;
            if (arg.name)
                argLength += arg.name.length + 1;

            if (lineLength + argLength > 100)
            {
                if (i != 0)
                {
                    snippet += ",";
                    lineLength += 1;
                }
                snippet += "\n"+indent+" ".repeat(preambleLength);
                lineLength = indent.length + preambleLength;
            }
            else if (i != 0)
            {
                snippet += ", ";
                lineLength += 2;
            }

            snippet += arg.typename;
            if (arg.name)
            {
                snippet += " ";
                snippet += arg.name;
            }

            lineLength += argLength;
        }
    }

    snippet += ")";
    return snippet;
}

function FindInsertPositionForGeneratedMethod(asmodule : scriptfiles.ASModule, afterPosition : Position) : [Position, string, string, string]
{
    let offset = asmodule.getOffset(afterPosition);
    let curScope = asmodule.getScopeAt(offset);

    let classScope = curScope.getParentTypeScope();
    let indent : string = null;
    let prefix : string = "";
    let suffix : string = "";

    // Just insert right here
    if (!classScope)
        return [Position.create(afterPosition.line, 0), "\t", prefix, suffix];

    // Find the first line in the class that has content, and base indentation on that
    for (let statement of classScope.statements)
    {
        let lines = statement.content.split("\n");
        for (let line of lines)
        {
            if (!/^[ \t\r\n]*$/.test(line))
            {
                indent = "";
                for (let i = 0; i < line.length; ++i)
                {
                    let curchar = line[i];
                    if (curchar == ' ' || curchar == '\t')
                    {
                        indent += curchar;
                    }
                    else if (curchar == '\n' || curchar == '\r')
                    {
                        continue;
                    }
                    else if (curchar == '#')
                    {
                        indent = null;
                        break;
                    }
                    else
                    {
                        break;
                    }
                }
                break;
            }
        }
        if (indent)
            break;
    }
    if (!indent)
        indent = "\t";

    // Find the first scope in our parent that starts after the position, and insert before it
    let classStartPos = asmodule.getPosition(classScope.start_offset);

    for (let subscope of classScope.scopes)
    {
        let startOffset = subscope.start_offset;
        while (startOffset < subscope.end_offset)
        {
            let curchar = asmodule.content[startOffset];
            if (curchar == ' ' || curchar == '\t' || curchar == '\r' || curchar == '\n')
                ++startOffset;
            else
                break;
        }

        let scopeStartPos = asmodule.getPosition(startOffset);
        let checkStartPos = scopeStartPos;
        if (subscope.element_head instanceof scriptfiles.ASStatement)
            checkStartPos = asmodule.getPosition(subscope.element_head.start_offset);
        else if (!subscope.element_head)
            checkStartPos = asmodule.getPosition(subscope.end_offset);

        if (checkStartPos.line >= afterPosition.line)
        {
            prefix += "\n";
            return [Position.create(scopeStartPos.line-1, 10000), indent, prefix, suffix];
        }
    }

    let endOfClass = asmodule.getPosition(classScope.end_offset);
    if (!asmodule.isLineEmpty(endOfClass.line-1))
        prefix += "\n";
    return [endOfClass, indent, prefix, suffix];
}

function AddMethodOverrideSnippets(context : CodeActionContext)
{
    if (!context.scope)
        return;

    let typeOfScope = context.scope.getParentType();
    if (!typeOfScope || !typeOfScope.supertype)
        return;

    let validScope = false;
    if (context.scope.scopetype == scriptfiles.ASScopeType.Class)
    {
        validScope = true;
    }
    // If we're inside the actual function declaration that's fine too
    else if (context.scope.scopetype == scriptfiles.ASScopeType.Function)
    {
        if (context.statement && context.statement.ast && context.statement.ast.type == scriptfiles.node_types.FunctionDecl)
        {
            validScope = true;
        }
    }
    if (!validScope)
        return;

    let foundOverrides = new Set<string>();
    for (let checktype of typeOfScope.getInheritanceTypes())
    {
        for (let method of checktype.methods)
        {
            if (checktype.isUnrealType() && !method.isEvent)
                continue;
            if (foundOverrides.has(method.name))
                continue;

            // Ignore methods we've already overridden
            let existingSymbol = typeOfScope.findFirstSymbol(method.name, typedb.DBAllowSymbol.FunctionOnly);
            if (!existingSymbol || !existingSymbol.containingType)
                continue;
            if (existingSymbol.containingType == typeOfScope)
                continue;

            // Ignore private methods
            if (method.isPrivate)
                continue;

            foundOverrides.add(method.name);
            if (method.isFinal)
                continue;

            context.actions.push(<CodeAction> {
                kind: CodeActionKind.RefactorRewrite,
                title: "Override: "+method.name+"()",
                source: "angelscript",
                data: {
                    uri: context.module.uri,
                    type: "methodOverride",
                    inside: method.containingType.typename,
                    name: method.name,
                    position: context.module.getPosition(context.range_start),
                }
            });
        }
    }
}

function ResolveMethodOverrideSnippet(asmodule : scriptfiles.ASModule, action : CodeAction, data : any)
{
    let insideType = typedb.GetType(data.inside);
    if (!insideType)
        return;

    let method = insideType.getMethod(data.name);
    if (!method)
        return;

    let offset = asmodule.getOffset(data.position);
    let scope = asmodule.getScopeAt(offset);
    let scopeType = scope ? scope.getParentType() : null;

    let [insertPosition, indent, prefix, suffix] = FindInsertPositionForGeneratedMethod(asmodule, data.position);
    let snippet = "";
    snippet += prefix;

    if (method.isEvent)
        snippet += indent+"UFUNCTION(BlueprintOverride)\n";

    snippet += GenerateMethodHeaderString("", indent, data.name, method.returnType, method.args);
    if (method.isConst)
        snippet += " const"
    if (!method.isEvent)
        snippet += " override";
    if (!method.isEvent && method.isProperty && method.declaredModule)
        snippet += " property";

    snippet += "\n";
    snippet += indent+"{\n";

    if (scopeType)
    {
        let parentType = typedb.GetType(scopeType.supertype);
        if (parentType)
        {
            let parentMethod = parentType.findFirstSymbol(method.name, typedb.DBAllowSymbol.FunctionOnly);
            if (parentMethod instanceof typedb.DBMethod && parentMethod.declaredModule && !parentMethod.isEmpty)
            {
                if (!method.returnType || method.returnType == "void")
                {
                    snippet += indent+indent+"Super::"+method.name+"(";
                    for (let i = 0; i < method.args.length; ++i)
                    {
                        if (i != 0)
                            snippet += ", ";
                        snippet += method.args[i].name;
                    }
                    snippet += ");\n";
                }
            }
        }
    }

    snippet += indent+"}\n";
    snippet += suffix;

    action.edit = <WorkspaceEdit> {};
    action.edit.changes = {};
    action.edit.changes[asmodule.displayUri] = [
        TextEdit.insert(insertPosition, snippet)
    ];
}

function GetTypeFromExpressionIgnoreNullptr(scope : scriptfiles.ASScope, node : any) : typedb.DBType
{
    if (node && node.type == scriptfiles.node_types.ConstNullptr)
        return null;
    return scriptfiles.ResolveTypeFromExpression(scope, node);
}

function AddCastHelpers(context : CodeActionContext)
{
    if (!context.scope)
        return;
    if (!context.statement)
        return;
    if (!context.statement.ast)
        return;

    let statement = context.statement;
    let scope = context.scope;

    let leftType : typedb.DBType = null;
    let rightType : typedb.DBType = null;

    if (statement.ast.type == scriptfiles.node_types.Assignment)
    {
        let leftNode = statement.ast.children[0];
        let rightNode = statement.ast.children[1];
        if (!leftNode || !rightNode)
            return;

        leftType = scriptfiles.ResolveTypeFromExpression(scope, leftNode);
        rightType = GetTypeFromExpressionIgnoreNullptr(scope, rightNode);
    }
    else if (statement.ast.type == scriptfiles.node_types.VariableDecl)
    {
        if (statement.ast.typename)
            leftType = typedb.GetType(statement.ast.typename.value);

        if (statement.ast.expression)
            rightType = GetTypeFromExpressionIgnoreNullptr(scope, statement.ast.expression);
    }
    else if (statement.ast.type == scriptfiles.node_types.ReturnStatement)
    {
        let dbFunc = scope.getDatabaseFunction();
        if (dbFunc && dbFunc.returnType)
            leftType = typedb.GetType(dbFunc.returnType);

        if (statement.ast.children && statement.ast.children[0])
            rightType = GetTypeFromExpressionIgnoreNullptr(scope, statement.ast.children[0]);
    }

    if (!leftType || !rightType)
        return;

    // Don't care about primitives
    if (leftType.isPrimitive || rightType.isPrimitive)
        return;

    // Don't care about structs
    if (leftType.isStruct || rightType.isStruct)
        return;

    // Maybe we can implicitly convert
    if (rightType.inheritsFrom(leftType.typename))
        return;
    
    // Cast needs to make sense
    if (!leftType.inheritsFrom(rightType.typename))
        return;

    context.actions.push(<CodeAction> {
        kind: CodeActionKind.QuickFix,
        title: "Cast to "+leftType.typename,
        source: "angelscript",
        data: {
            uri: context.module.uri,
            type: "addCast",
            castTo: leftType.typename,
            position: context.module.getPosition(context.range_start),
        }
    });
}

function ResolveCastHelper(asmodule : scriptfiles.ASModule, action : CodeAction, data : any)
{
    let offset = asmodule.getOffset(data.position);
    let scope = asmodule.getScopeAt(offset);
    if (!scope)
        return;
    let statement = asmodule.getStatementAt(offset);
    if (!statement)
        return;
    if (!statement.ast)
        return;

    let rightNode : any = null;
    if (statement.ast.type == scriptfiles.node_types.Assignment)
    {
        rightNode = statement.ast.children[1];
    }
    else if (statement.ast.type == scriptfiles.node_types.VariableDecl)
    {
        rightNode = statement.ast.expression;
    }
    else if (statement.ast.type == scriptfiles.node_types.ReturnStatement)
    {
        if (statement.ast.children && statement.ast.children[0])
            rightNode = statement.ast.children[0]
    }

    if (!rightNode)
        return;

    action.edit = <WorkspaceEdit> {};
    action.edit.changes = {};
    action.edit.changes[asmodule.displayUri] = [
        TextEdit.insert(
            asmodule.getPosition(statement.start_offset + rightNode.start),
            "Cast<"+data.castTo+">("),
        TextEdit.insert(
            asmodule.getPosition(statement.start_offset + rightNode.end),
            ")"),
    ];
}

function AddSuperCallHelper(context : CodeActionContext)
{
    for (let diag of context.diagnostics)
    {
        let data = diag.data as any;
        if (data && data.type == "superCall")
        {
            context.actions.push(<CodeAction> {
                kind: CodeActionKind.QuickFix,
                title: "Add call to Super::"+data.name+"(...)",
                source: "angelscript",
                diagnostics: [diag],
                isPreferred: true,
                data: {
                    uri: context.module.uri,
                    type: "superCall",
                    name: data.name,
                    inType: data.inType,
                    position: context.module.getPosition(context.range_end),
                }
            });
        }
    }
}

function ResolveSuperCallHelper(asmodule : scriptfiles.ASModule, action : CodeAction, data : any)
{
    let offset = asmodule.getOffset(data.position);
    let scope = asmodule.getScopeAt(offset)
    if (!scope)
        return;

    let scopeFunc = scope.getParentFunction();
    if (!scopeFunc)
        return;

    let superType = typedb.GetType(data.inType);
    if (!superType)
        return;
    let superMethod = superType.findFirstSymbol(data.name, typedb.DBAllowSymbol.FunctionOnly);
    if (!superMethod)
        return;
    if (!(superMethod instanceof typedb.DBMethod))
        return;

    let [insertPosition, indent, prefix, suffix] = FindInsertPositionFunctionStart(scope);

    let callString = prefix+indent+"Super::"+superMethod.name+"(";
    if (scopeFunc.args)
    {
        for (let i = 0; i < scopeFunc.args.length; ++i)
        {
            if (i != 0)
                callString += ", ";
            callString += scopeFunc.args[i].name;
        }
    }

    callString += ");"+suffix;

    action.edit = <WorkspaceEdit> {};
    action.edit.changes = {};
    action.edit.changes[asmodule.displayUri] = [
        TextEdit.insert(insertPosition, callString)
    ];
}

function FindInsertPositionFunctionStart(scope : scriptfiles.ASScope) : [Position, string, string, string]
{
    let indent : string = null;
    let prefix : string = "";
    let suffix : string = "";

    // Find the first line in the class that has content, and base indentation on that
    let endLine = scope.module.getPosition(scope.end_offset).line;
    let curLine = scope.module.getPosition(scope.declaration.end_offset).line + 1;
    while (curLine < endLine)
    {
        let lineText = scope.module.getLineText(curLine);
        if (!/^[\r\n]*$/.test(lineText))
        {
            indent = "";
            for (let i = 0; i < lineText.length; ++i)
            {
                let curchar = lineText[i];
                if (curchar == ' ' || curchar == '\t')
                {
                    indent += curchar;
                }
                else if (curchar == '\n' || curchar == '\r')
                {
                    continue;
                }
                else if (curchar == '#')
                {
                    indent = null;
                    break;
                }
                else
                {
                    break;
                }
            }
            if (indent != null)
                break;
        }
    }

    if(indent == null)
    {
        // Double the class indent
        let [subPos, subIndent, subPrefix, subSuffix] = FindInsertPositionForGeneratedMethod(
            scope.module,
            scope.module.getPosition(scope.declaration.end_offset));
        indent = subIndent + subIndent;
    }

    if (indent == null)
        indent = "\t\t";

    let headPos = scope.module.getPosition(scope.declaration.end_offset);
    prefix += "\n";
    return [Position.create(headPos.line, 100000), indent, prefix, suffix];
}

function AddAutoActions(context : CodeActionContext)
{
    for (let symbol of context.module.symbols)
    {
        if (!symbol.isAuto)
            continue;
        if (!symbol.overlapsRange(context.range_start, context.range_end))
            continue;

        let realTypename = symbol.symbol_name;
        if (realTypename.startsWith("__"))
            realTypename = realTypename.substr(2);

        let dbtype = typedb.GetType(realTypename);
        if (!dbtype)
            continue;

        context.actions.push(<CodeAction> {
            kind: CodeActionKind.RefactorInline,
            title: "Change auto to "+dbtype.getDisplayName(),
            source: "angelscript",
            isPreferred: true,
            data: {
                uri: context.module.uri,
                type: "materializeAuto",
                typename: realTypename,
                symbol: symbol,
            }
        });
    }
}

function ResolveAutoAction(asmodule : scriptfiles.ASModule, action : CodeAction, data : any)
{
    let symbol = data.symbol as scriptfiles.ASSymbol;
    let typename = data.typename;

    action.edit = <WorkspaceEdit> {};
    action.edit.changes = {};

    action.edit.changes[asmodule.displayUri] = [
        TextEdit.replace(
            asmodule.getRange(symbol.start, symbol.end),
            typename,
        )
    ];
}

function AddVariablePromotionHelper(context : CodeActionContext)
{
    if (!context.scope)
        return;
    if (!context.statement)
        return;

    let codeNode = context.statement.ast;
    if (!codeNode)
        return;

    if (codeNode.type == scriptfiles.node_types.Assignment)
    {
        let leftNode = codeNode.children[0];
        if (!leftNode || leftNode.type != scriptfiles.node_types.Identifier)
            return;

        // If the left side is a known variable we can't provide this action
        let lvalueType = scriptfiles.ResolveTypeFromExpression(context.scope, leftNode);
        if (lvalueType)
            return;

        // If we don't know what type is on the right we can't provide this action
        let rvalueType = scriptfiles.ResolveTypeFromExpression(context.scope, codeNode.children[1]);
        if(!rvalueType)
            return;

        let variableName = leftNode.value;

        context.actions.push(<CodeAction> {
            kind: CodeActionKind.RefactorInline,
            title: `Promote ${variableName} to member variable`,
            source: "angelscript",
            isPreferred: true,
            data: {
                uri: context.module.uri,
                type: "variablePromotion",
                variableName: variableName,
                variableType: rvalueType.typename,
                position: context.range_start,
            }
        });
    }
}

function FindInsertPositionForGeneratedMemberVariable(asmodule : scriptfiles.ASModule, classScope : scriptfiles.ASScope, anchor_offset : number = -1) : [Position, string]
{
    let indent : string = null;
    let prefix : string = "";
    let suffix : string = "";

    // Find the first line in the class that has content, and base indentation on that
    for (let statement of classScope.statements)
    {
        let lines = statement.content.split("\n");
        for (let line of lines)
        {
            if (!/^[ \t\r\n]*$/.test(line))
            {
                indent = "";
                for (let i = 0; i < line.length; ++i)
                {
                    let curchar = line[i];
                    if (curchar == ' ' || curchar == '\t')
                    {
                        indent += curchar;
                    }
                    else if (curchar == '\n' || curchar == '\r')
                    {
                        continue;
                    }
                    else if (curchar == '#')
                    {
                        indent = null;
                        break;
                    }
                    else
                    {
                        break;
                    }
                }
                break;
            }
        }
        if (indent)
            break;
    }
    if (!indent)
        indent = "\t";

    // Check if we have a member variable that anchors this one
    let anchoredVariable : string = null;
    if (anchor_offset != -1)
    {
        let subScope = classScope.getScopeAt(anchor_offset);
        if (subScope)
        {
            for (let statement of subScope.statements)
            {
                if (!statement)
                    continue;
                if (!statement.ast)
                    continue;
                if (statement.end_offset >= anchor_offset)
                    continue;

                if (statement.ast.type == scriptfiles.node_types.Assignment)
                {
                    if (statement.ast.children[0] && statement.ast.children[0].type == scriptfiles.node_types.Identifier)
                    {
                        let varName = statement.ast.children[0].value;
                        if (classScope.variablesByName.has(varName))
                            anchoredVariable = varName;
                    }
                }
            }
        }
    }

    // Collect data about where stuff is in the class
    let lastDefaultLineOffset = -1;
    let lastMemberVariableOffset = -1;
    let anchoredMemberVariableOffset = -1;

    for (let statement of classScope.statements)
    {
        if (!statement.ast)
            continue;

        if (statement.ast.type == scriptfiles.node_types.VariableDecl)
        {
            if (anchoredVariable && statement.ast.name && statement.ast.name.value == anchoredVariable)
                anchoredMemberVariableOffset = statement.end_offset;
            if (statement.end_offset > lastMemberVariableOffset)
                lastMemberVariableOffset = statement.end_offset;
        }
        else if (statement.ast.type == scriptfiles.node_types.DefaultStatement)
        {
            if (statement.end_offset > lastDefaultLineOffset)
                lastDefaultLineOffset = statement.end_offset;
        }
    }

    let afterPos : Position = null;
    if (anchoredMemberVariableOffset != -1)
    {
        // Insert after the member variable that was most recently assigned
        afterPos = asmodule.getPosition(anchoredMemberVariableOffset);
    }
    else if (lastMemberVariableOffset != -1)
    {
        // Insert after the last member variable declaration
        afterPos = asmodule.getPosition(lastMemberVariableOffset);
    }
    else if (lastDefaultLineOffset != -1)
    {
        // Insert after the last default statement
        afterPos = asmodule.getPosition(lastDefaultLineOffset);
    }
    else
    {
        // Insert at the top of the class
        afterPos = asmodule.getPosition(classScope.declaration.end_offset);
    }

    afterPos.line += 1;
    afterPos.character = 0;
    return [afterPos, indent];
}

function ResolveVariablePromotionHelper(asmodule : scriptfiles.ASModule, action : CodeAction, data : any)
{
    let variableName : string = data.variableName;
    let variableType : string = data.variableType;
    let position : number = data.position;

    let scope = asmodule.getScopeAt(position);
    if (!scope)
        return;

    let classScope = scope.getParentTypeScope();
    if (!classScope)
        return;

    let [insertPosition, indent] = FindInsertPositionForGeneratedMemberVariable(asmodule, classScope, position);

    action.edit = <WorkspaceEdit> {};
    action.edit.changes = {};

    let declarationString = `${indent}${variableType} ${variableName};\n`;

    action.edit.changes[asmodule.displayUri] = [
        TextEdit.insert(insertPosition, declarationString)
    ];
}

function AddMemberActions(context : CodeActionContext)
{
    if (!context.scope)
        return;
    if (!context.statement)
        return;
    if (!context.statement.ast)
        return;

    let dbType = context.scope.getParentType();
    if (context.statement.ast.type == scriptfiles.node_types.FunctionDecl
        && context.statement.ast.name
        && !context.statement.ast.macro)
    {
        if (!dbType || dbType.isNamespaceOrGlobalScope() || !dbType.isStruct)
        {
            let isOverrideEvent = false;
            if (dbType)
            {
                let superType = typedb.GetType(dbType.supertype);
                if (superType)
                {
                    let superFunc = superType.findFirstSymbol(context.statement.ast.name.value, typedb.DBAllowSymbol.FunctionOnly);
                    if (superFunc && superFunc instanceof typedb.DBMethod)
                    {
                        if (superFunc.isEvent)
                            isOverrideEvent = true;
                    }
                }
            }

            if (isOverrideEvent)
            {
                context.actions.push(<CodeAction> {
                    kind: CodeActionKind.RefactorInline,
                    title: `Add UFUNCTION(BlueprintOverride)`,
                    source: "angelscript",
                    data: {
                        uri: context.module.uri,
                        type: "insertMacro",
                        macro: "UFUNCTION(BlueprintOverride)",
                        position: context.range_start,
                    }
                });
            }
            else
            {
                if (dbType)
                {
                    let scopeFunc = dbType.getMethod(context.statement.ast.name.value);
                    if (scopeFunc
                        && scopeFunc.isConst
                        && scopeFunc.returnType
                        && scopeFunc.returnType != "void")
                    {
                        context.actions.push(<CodeAction> {
                            kind: CodeActionKind.RefactorInline,
                            title: `Add UFUNCTION(BlueprintPure)`,
                            source: "angelscript",
                            data: {
                                uri: context.module.uri,
                                type: "insertMacro",
                                macro: "UFUNCTION(BlueprintPure)",
                                position: context.range_start,
                            }
                        });
                    }
                }

                context.actions.push(<CodeAction> {
                    kind: CodeActionKind.RefactorInline,
                    title: `Add UFUNCTION()`,
                    source: "angelscript",
                    data: {
                        uri: context.module.uri,
                        type: "insertMacro",
                        macro: "UFUNCTION()",
                        position: context.range_start,
                    }
                });
            }
        }
    }
    else if (context.statement.ast.type == scriptfiles.node_types.VariableDecl
        && context.statement.ast.name
        && !context.statement.ast.macro)
    {
        if (dbType && !dbType.isNamespaceOrGlobalScope()
            && context.scope.scopetype == scriptfiles.ASScopeType.Class)
        {
            let variableName = context.statement.ast.name.value;
            let varType = typedb.GetType(context.statement.ast.typename.value);

            if (varType && varType.inheritsFrom("UActorComponent")
                && !dbType.isStruct
                && dbType.inheritsFrom("AActor"))
            {
                context.actions.push(<CodeAction> {
                    kind: CodeActionKind.RefactorInline,
                    title: `Add UPROPERTY(DefaultComponent)`,
                    source: "angelscript",
                    data: {
                        uri: context.module.uri,
                        type: "insertMacro",
                        macro: "UPROPERTY(DefaultComponent)",
                        position: context.range_start,
                    }
                });
            }

            context.actions.push(<CodeAction> {
                kind: CodeActionKind.RefactorInline,
                title: `Add UPROPERTY()`,
                source: "angelscript",
                data: {
                    uri: context.module.uri,
                    type: "insertMacro",
                    macro: "UPROPERTY()",
                    position: context.range_start,
                }
            });
        }
    }
}

function ResolveInsertMacro(asmodule : scriptfiles.ASModule, action : CodeAction, data : any)
{
    let position : number = data.position;
    let macro : string = data.macro;

    let statement = asmodule.getStatementAt(position);
    if (!statement)
        return;
    if (!statement.ast)
        return;

    let scope = asmodule.getScopeAt(position);
    if (!scope)
        return;

    let classScope = scope.getParentTypeScope();
    if (!classScope)
        return;

    let [_, indent] = FindInsertPositionForGeneratedMemberVariable(asmodule, classScope, position);

    action.edit = <WorkspaceEdit> {};
    action.edit.changes = {};

    let macroString = `${indent}${macro}\n`;

    let insertPosition : Position = null;
    if (statement.ast.name)
    {
        insertPosition = asmodule.getPosition(statement.start_offset + statement.ast.name.start);
        insertPosition.character = 0;
    }
    else
    {
        insertPosition = asmodule.getPosition(position);
        insertPosition.character = 0;
    }

    action.edit.changes[asmodule.displayUri] = [
        TextEdit.insert(insertPosition, macroString)
    ];
}

function AddSwitchCaseActions(context : CodeActionContext)
{
    if (!context.scope)
        return;

    // Ensure that this is a switch scope
    let switchBlock : scriptfiles.ASScope = null;
    let switchStatement : scriptfiles.ASStatement = null;

    if (context.statement && context.statement.ast && context.statement.ast.type == scriptfiles.node_types.SwitchStatement)
    {
        if (context.statement.next && context.statement.next instanceof scriptfiles.ASScope)
        {
            switchStatement = context.statement;
            switchBlock = context.statement.next;
        }
    }
    else if (context.scope.previous && context.scope.previous instanceof scriptfiles.ASStatement)
    {
        if (context.scope.previous.ast && context.scope.previous.ast.type == scriptfiles.node_types.SwitchStatement)
        {
            switchStatement = context.scope.previous;
            switchBlock = context.scope;
        }
    }

    if (!switchBlock)
        return;
    if (!switchBlock.parentscope)
        return;

    // Figure out what type we're switching on
    let switchOnType = scriptfiles.ResolveTypeFromExpression(switchBlock.parentscope, switchStatement.ast.children[0]);
    if (!switchOnType)
        return;
    if (!switchOnType.isEnum)
        return;

    // Find all cases that are implemented
    let implementedCases = new Array<string>();
    let defaultStatement : scriptfiles.ASStatement = null;
    for (let caseStatement of switchBlock.statements)
    {
        if (!caseStatement || !caseStatement.ast)
            continue;

        if (caseStatement.ast.type == scriptfiles.node_types.DefaultCaseStatement)
        {
            defaultStatement = caseStatement;
            continue;
        }
        else if (caseStatement.ast.type != scriptfiles.node_types.CaseStatement)
            continue;
        
        let labelNode = caseStatement.ast.children[0];
        if (!labelNode || labelNode.type != scriptfiles.node_types.NamespaceAccess)
            continue;

        if (!labelNode.children[0] || !labelNode.children[0].value)
            continue;
        if (!labelNode.children[1] || !labelNode.children[1].value)
            continue;

        let label = labelNode.children[0].value + "::" + labelNode.children[1].value;
        implementedCases.push(label);
    }

    // Check if there are any missing cases left
    let missingCases = new Array<string>();
    for (let prop of switchOnType.properties)
    {
        if (prop.name == "MAX")
            continue;
        if (prop.name.endsWith("_MAX"))
            continue;

        let label = switchOnType.getDisplayName()+"::"+prop.name;
        if (!implementedCases.includes(label))
            missingCases.push(label);
    }

    // Add code action for adding all missing cases
    if (missingCases.length >= 2)
    {
        context.actions.push(<CodeAction> {
            kind: CodeActionKind.RefactorInline,
            title: `Add all missing ${switchOnType.getDisplayName()} cases`,
            source: "angelscript",
            data: {
                uri: context.module.uri,
                type: "insertCases",
                cases: missingCases,
                switchPosition: switchStatement.start_offset,
                position: context.scope.start_offset,
                defaultCasePosition: defaultStatement ? defaultStatement.start_offset : -1,
            }
        });
    }

    // Add code action for adding individual missing cases
    for (let label of missingCases)
    {
        context.actions.push(<CodeAction> {
            kind: CodeActionKind.RefactorInline,
            title: `Add case ${label}`,
            source: "angelscript",
            data: {
                uri: context.module.uri,
                type: "insertCases",
                cases: [label],
                switchPosition: switchStatement.start_offset,
                position: context.scope.start_offset,
                defaultCasePosition: defaultStatement ? defaultStatement.start_offset : -1,
            }
        });
    }
}


function ResolveInsertCases(asmodule : scriptfiles.ASModule, action : CodeAction, data : any)
{
    let switchStatement = asmodule.getStatementAt(data.switchPosition);
    if (!switchStatement)
        return;
    if (!switchStatement.next)
        return;
    if (!(switchStatement.next instanceof scriptfiles.ASScope))
        return;

    let switchScope : scriptfiles.ASScope = switchStatement.next;
    if (!switchScope)
        return;

    action.edit = <WorkspaceEdit> {};
    action.edit.changes = {};

    let switchIndent = GetIndentForStatement(switchStatement);
    let indent = GetIndentForBlock(switchScope);
    if (!indent)
        indent = "";

    let insertString = "";
    let cases : Array<string> = data.cases;
    for (let label of cases)
        insertString += `${indent}case ${label}:\n${indent}break;\n`; 

    let insertPosition : Position = null;
    if (data.defaultCasePosition != -1)
    {
        insertPosition = asmodule.getPosition(data.defaultCasePosition);
        insertString = "\n" + insertString.substring(0, insertString.length-1);
    }
    else
    {
        let lastElement = switchScope.element_head;
        while (lastElement && lastElement.next)
            lastElement = lastElement.next;

        while (lastElement)
        {
            if (lastElement instanceof scriptfiles.ASScope)
            {
                insertPosition = asmodule.getPosition(lastElement.end_offset);
                insertPosition.line += 1;
                insertPosition.character = 0;
                break;
            }
            else if (lastElement instanceof scriptfiles.ASStatement)
            {
                if (lastElement && lastElement.ast)
                {
                    insertPosition = asmodule.getPosition(lastElement.end_offset);
                    insertPosition.line += 1;
                    insertPosition.character = 0;
                    break;
                }
            }

            lastElement = lastElement.previous;
        }

        if (!insertPosition)
        {
            let scopeStart = asmodule.getPosition(switchScope.start_offset);
            let scopeEnd = asmodule.getPosition(switchScope.end_offset);

            if (scopeEnd.line == scopeStart.line)
            {
                insertPosition = asmodule.getPosition(switchScope.start_offset);
                insertString = "\n" + insertString + switchIndent;
            }
            else if (scopeEnd.line == scopeStart.line + 1)
            {
                insertPosition = asmodule.getPosition(switchScope.start_offset);
                insertString = "\n" + insertString.trimEnd();
            }
            else
            {
                insertPosition = asmodule.getPosition(switchScope.end_offset);
                insertPosition.line -= 1;
                insertPosition.character = 10000;
                insertString = insertString.substring(0, insertString.length-1).trimStart();
            }
        }
    }

    action.edit.changes[asmodule.displayUri] = [
        TextEdit.insert(insertPosition, insertString)
    ];
}

function GetIndentForStatement(statement : scriptfiles.ASStatement) : string
{
    let indent : string = null;
    let lines = statement.content.split("\n");
    for (let line of lines)
    {
        if (!/^[ \t\r\n]*$/.test(line))
        {
            indent = "";
            for (let i = 0; i < line.length; ++i)
            {
                let curchar = line[i];
                if (curchar == ' ' || curchar == '\t')
                {
                    indent += curchar;
                }
                else if (curchar == '\n' || curchar == '\r')
                {
                    continue;
                }
                else if (curchar == '#')
                {
                    indent = null;
                    break;
                }
                else
                {
                    break;
                }
            }
            break;
        }
    }
    return indent;
}

function GetIndentForBlock(scope : scriptfiles.ASScope) : string
{
    if (scope.statements.length != 0 && scope.statements[0])
    {
        for (let statement of scope.statements)
        {
            if (!statement)
                continue;
            let statementIndent = GetIndentForStatement(statement);
            if (statementIndent != null)
                return statementIndent;
        }
    }
    else
    {
        if (scope.previous && scope.previous instanceof scriptfiles.ASStatement)
        {
            let statementIndent = GetIndentForStatement(scope.previous);
            if (statementIndent != null)
            {
                return ExtendIndent(statementIndent);
            }
        }
    }

    return null;
}

function ExtendIndent(indent : string) : string
{
    if (!indent || indent.length == 0)
        return "\t";
    if (indent.includes("\t"))
        return indent + "\t";
    else
        return indent + "    ";
}