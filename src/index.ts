import antlr4 from 'antlr4'
import { TokenSuggester } from './tokensuggester'
import { LexerWrapper } from './lexerWrapper'
import { ATOM_TRANSITION, SET_TRANSITION } from './antlr4Constants'

export type CasePreference = "LOWER" | "UPPER" | "BOTH"
export type Token = { channel: number }

interface Constructor<T> {
    new(...args: any[]): T;
}

class AutoSuggestionsGenerator {
    private lexerWrapper: LexerWrapper
    private lexerAndParserFactory: any
    private input: string
    private inputTokens: { type: string }[]
    private untokenizedText: string
    private parserAtn?: any
    private parserRuleNames: string[]
    private indent: string
    private collectedSuggestions: string[]
    private casePreference: CasePreference | null
    private parserStateToTokenListIndexWhereLastVisited: any

    constructor(lexerAndParserFactory, input: string) {
        this.lexerWrapper = new LexerWrapper(lexerAndParserFactory)
        this.lexerAndParserFactory = lexerAndParserFactory
        this.input = input
        this.inputTokens = []
        this.untokenizedText = ''
        this.parserAtn = null
        this.parserRuleNames = []
        this.indent = ''
        this.collectedSuggestions = []
        this.casePreference = 'BOTH'
        this.parserStateToTokenListIndexWhereLastVisited = new Map()

        return this
    }

    suggest() {
        this.tokenizeInput()
        this.storeParserAtnAndRuleNames()
        this.runParserAtnAndCollectSuggestions()
        return this.collectedSuggestions
    }

    tokenizeInput() {
        const tokenizationResult = this.lexerWrapper.tokenizeNonDefaultChannel(this.input)
        this.inputTokens = tokenizationResult.tokens
        this.untokenizedText = tokenizationResult.untokenizedText
    }

    setCasePreference(casePreference) {
        this.casePreference = casePreference
    }

    filterOutNonDefaultChannels(tokens: Token[]) {
        return tokens.filter((token) => token.channel === 0)
    }

    storeParserAtnAndRuleNames() {
        const tokenStream = this.lexerWrapper.getEmptyTokenStream()
        const parser = this.lexerAndParserFactory.createParser(tokenStream)
        this.parserAtn = parser.atn
        this.parserRuleNames = parser.ruleNames
    }

    runParserAtnAndCollectSuggestions() {
        const initialState = this.parserAtn.states[0]
        this.parseAndCollectTokenSuggestions(initialState, 0)
    }

    parseAndCollectTokenSuggestions(parserState, tokenListIndex) {
        const prevIndent = this.indent
        this.indent += '  '
        if (this.didVisitParserStateOnThisTokenIndex(parserState, tokenListIndex)) {
            return
        }
        const previousTokenListIndexForThisState = this.setParserStateLastVisitedOnThisTokenIndex(parserState, tokenListIndex)
        try {
            if (!this.hasMoreTokens(tokenListIndex)) { // stop condition for recursion
                this.suggestNextTokensForParserState(parserState)
                return
            }
            for (let trans of parserState.transitions) {
                if (trans.isEpsilon) {
                    this.handleEpsilonTransition(trans, tokenListIndex)
                } else if (trans.serializationType === ATOM_TRANSITION) {
                    this.handleAtomicTransition(trans, tokenListIndex)
                } else {
                    this.handleSetTransition(trans, tokenListIndex)
                }
            }
        } finally {
            this.indent = prevIndent
            this.setParserStateLastVisitedOnThisTokenIndex(parserState, previousTokenListIndexForThisState)
        }
    }

    didVisitParserStateOnThisTokenIndex(parserState, currentTokenListIndex) {
        const lastVisitedThisStateAtTokenListIndex = this.parserStateToTokenListIndexWhereLastVisited.get(parserState)
        return currentTokenListIndex === lastVisitedThisStateAtTokenListIndex
    }

    setParserStateLastVisitedOnThisTokenIndex(parserState, tokenListIndex) {
        const previous = this.parserStateToTokenListIndexWhereLastVisited.get(parserState)
        if (typeof tokenListIndex === 'undefined') {
            this.parserStateToTokenListIndexWhereLastVisited.delete(parserState)
        } else {
            this.parserStateToTokenListIndexWhereLastVisited.set(parserState, tokenListIndex)
        }
        return previous
    }

    hasMoreTokens(index: number) {
        return index < this.inputTokens.length
    }

    handleEpsilonTransition(trans, tokenListIndex: number) {
        this.parseAndCollectTokenSuggestions(trans.target, tokenListIndex)
    }

    handleAtomicTransition(trans, tokenListIndex: number) {
        const nextToken = this.inputTokens.slice(tokenListIndex, tokenListIndex + 1)[0]
        const nextTokenType = nextToken.type
        const nextTokenMatchesTransition = (trans.label.contains(nextTokenType))
        if (nextTokenMatchesTransition) {
            this.parseAndCollectTokenSuggestions(trans.target, tokenListIndex + 1)
        }
    }

    handleSetTransition(trans, tokenListIndex: number) {
        const nextToken = this.inputTokens.slice(tokenListIndex, tokenListIndex + 1)[0]
        const nextTokenType = nextToken.type
        for (let interval of trans.label.intervals) {
            for (let transitionTokenType = interval.start; transitionTokenType <= interval.stop; ++transitionTokenType) {
                const nextTokenMatchesTransition = (transitionTokenType === nextTokenType)
                if (nextTokenMatchesTransition) {
                    this.parseAndCollectTokenSuggestions(trans.target, tokenListIndex + 1)
                }
            }
        }
    }

    suggestNextTokensForParserState(parserState) {
        const transitionLabels = new Set()
        this.fillParserTransitionLabels(parserState, transitionLabels, new Set())
        const tokenSuggester = new TokenSuggester(this.untokenizedText, this.lexerWrapper, this.casePreference)
        const suggestions = tokenSuggester.suggest(transitionLabels)
        this.parseSuggestionsAndAddValidOnes(parserState, suggestions)
    }

    fillParserTransitionLabels = function (parserState, result, visitedTransitions) {
        for (let trans of parserState.transitions) {
            const transKey = toTransKey(parserState, trans)
            if (visitedTransitions.has(transKey)) {
                return
            }
            if (trans.isEpsilon) {
                visitedTransitions.add(transKey)
                try {
                    this.fillParserTransitionLabels(trans.target, result, visitedTransitions)
                } finally {
                    visitedTransitions.delete(transKey)
                }
            } else if (trans.serializationType === ATOM_TRANSITION) {
                result.add(trans.label_)
            } else if (trans.serializationType === SET_TRANSITION) {
                for (let interval of trans.label.intervals) {
                    for (let i = interval.start; i < interval.stop; ++i) {
                        result.add(i)
                    }
                }
            }
        }
    }
    
    parseSuggestionsAndAddValidOnes(parserState, suggestions) {
        for (let suggestion of suggestions) {
            const addedToken = this.getAddedToken(suggestion)
            if (this.isParseableWithAddedToken(parserState, addedToken, new Set())) {
                if (!this.collectedSuggestions.includes(suggestion)) {
                    this.collectedSuggestions.push(suggestion)
                }
            }
        }
    }

    getAddedToken(suggestedCompletion) {
        const completedText = this.input + suggestedCompletion
        const completedTextTokens = this.lexerWrapper.tokenizeNonDefaultChannel(completedText).tokens
        if (completedTextTokens.length <= this.inputTokens.length) {
            return null // Completion didn't yield whole token, could be just a token fragment
        }
        const newToken = completedTextTokens[completedTextTokens.length - 1]
        return newToken
    }

    isParseableWithAddedToken(parserState, newToken, visitedTransitions: Set<any>) {
        if (newToken == null) {
            return false
        }
        let parseable = false
        for (let parserTransition of parserState.transitions) {
            if (parserTransition.isEpsilon) { // Recurse through any epsilon transitions
                const transKey = toTransKey(parserState, parserTransition)
                if (visitedTransitions.has(transKey)) {
                    return
                }
                visitedTransitions.add(transKey)
                try {
                    if (this.isParseableWithAddedToken(parserTransition.target, newToken, visitedTransitions)) {
                        parseable = true
                    }
                } finally {
                    visitedTransitions.delete(transKey)
                }
            } else if (parserTransition.serializationType === ATOM_TRANSITION) {
                const transitionTokenType = parserTransition.label
                if (transitionTokenType.first() === newToken.type) {
                    parseable = true
                }
            } else if (parserTransition.serializationType === SET_TRANSITION) {
                for (let interval of parserTransition.label.intervals) {
                    for (let transitionTokenType = interval.start; transitionTokenType <= interval.stop; ++transitionTokenType) {
                        if (transitionTokenType === newToken.type) {
                            parseable = true
                        }
                    }
                }
            } else {
                throw 'Unexpected: ' + transToStr(parserTransition)
            }
        }
        return parseable
    }
}

const transToStr = function (trans) {
    return '' + trans.constructor.name + '->' + trans.target
}

const toTransKey = function (src, trans) {
    return '' + src.stateNumber + '->(' + trans.serializationType + ') ' + trans.target.stateNumber
}

class AutoSuggester {
    lexerCtr: Constructor<antlr4.Lexer>
    parserCtr: Constructor<antlr4.Parser>
    casePreference?: CasePreference | null
    
    constructor(lexerCtr: Constructor<antlr4.Lexer>, parserCtr: Constructor<antlr4.Parser>, casePreference) {
        this.lexerCtr = lexerCtr
        this.parserCtr = parserCtr
        this.casePreference = casePreference
        this.assertLexerHasAtn()
        return this
    }

    createLexer(input: string) {
        return new this.lexerCtr(input)
    }

    createParser(tokenStream) {
        return new this.parserCtr(tokenStream)
    }

    autosuggest(inputText: string) {
        const generator =  new AutoSuggestionsGenerator(this, inputText)
        if (this.casePreference) {
            generator.setCasePreference(this.casePreference)
        }
        return generator.suggest()
    }

    private assertLexerHasAtn() {
        const lexer = new this.lexerCtr(null)
        // @ts-ignore
        if (typeof lexer.atn === 'undefined') {
            throw "Please use ANTLR4 version 4.7.1 or above."
        }
        return lexer
    }
}

export const autosuggester = (lexerCtr: Constructor<antlr4.Lexer>, parserCtr: Constructor<antlr4.Parser>, casePref: CasePreference | null = null) => {
    return new AutoSuggester(lexerCtr, parserCtr, casePref)
}
