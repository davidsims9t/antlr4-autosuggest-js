import antlr4 from 'antlr4'

export class LexerWrapper {
    lexerFactory: any
    cachedLexer: any

    constructor(lexerFactory: any) {
        this.lexerFactory = lexerFactory
        this.cachedLexer = null
    }

    tokenizeNonDefaultChannel(input) {
        const result = this.tokenize(input)
        result.tokens = result.tokens.filter((token) => token.channel === 0)
        return result
    }

    tokenize(input) {
        const lexer = this.createLexer(input)
        lexer.removeErrorListeners()
        const result = {
            untokenizedText: '',
            tokens: []
        }
        const newErrorListener = Object.create(antlr4.error.ErrorListener)
        newErrorListener.syntaxError = (recognizer, offendingSymbol, line, column, msg, e) => {
            result.untokenizedText = input.substring(column)
        }
        lexer.addErrorListener(newErrorListener)
        result.tokens = lexer.getAllTokens()
        return result
    }

    createEmptyLexer() {
        return this.createLexer('');
    }

    getCachedLexer() {
        if (this.cachedLexer === null) {
            this.cachedLexer = this.createEmptyLexer()
        }
        return this.cachedLexer
    }

    createLexer(lexerInput) {
        const inputStream = new antlr4.InputStream(lexerInput)
        const lexer = this.lexerFactory.createLexer(inputStream)
        return lexer
    }

    getEmptyTokenStream() {
        return new antlr4.CommonTokenStream(this.getCachedLexer())
    }
}