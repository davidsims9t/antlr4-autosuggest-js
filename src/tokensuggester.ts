import { ATOM_TRANSITION, SET_TRANSITION } from "./antlr4Constants"
import { CasePreference } from "./index"
import { LexerWrapper } from "./lexerWrapper"

type LexerState = {
    stateNumber: number
    transitions: any[]
}
export class TokenSuggester {
    private origPartialToken: any
    private lexerWrapper: LexerWrapper
    private suggestions: string[]
    private visitedLexerStates: number[]
    private casePreference: CasePreference | null

    constructor(origPartialToken, lexerWrapper: LexerWrapper, casePreference: CasePreference | null = null) {
        this.origPartialToken = origPartialToken
        this.lexerWrapper = lexerWrapper
        this.suggestions = []
        this.visitedLexerStates = []
        this.casePreference = casePreference
        return this
    }

    suggest(nextParserTransitionLabels) {
        for (let nextParserTransitionLabel of nextParserTransitionLabels) {
            const nextTokenRuleNumber = nextParserTransitionLabel - 1 // Count from 0 not from 1
            const lexerState = this.lexerWrapper.findStateByRuleNumber(nextTokenRuleNumber)
            this._suggest('', lexerState, this.origPartialToken)
        }
        return this.suggestions
    }

    private _suggest(tokenSoFar, lexerState: LexerState, remainingText) {
        if (this.visitedLexerStates.includes(lexerState.stateNumber)) {
            return // avoid infinite loop and stack overflow
        }
        this.visitedLexerStates.push(lexerState.stateNumber)
        try {
            const tokenNotEmpty = (tokenSoFar.length > 0)
            const noMoreCharactersInToken = (lexerState.transitions.length === 0)
            if (tokenNotEmpty && noMoreCharactersInToken) {
                this.addSuggestedToken(tokenSoFar)
            }
            for (let trans of lexerState.transitions) {
                this.suggestViaLexerTransition(tokenSoFar, remainingText, trans)
            }
        } finally {
            this.visitedLexerStates.pop()
        }
    }

    private suggestViaLexerTransition(tokenSoFar, remainingText, trans) {
        if (trans.isEpsilon) {
            this._suggest(tokenSoFar, trans.target, remainingText)
        } else if (trans.serializationType === ATOM_TRANSITION) {
            const newTokenChar = this.getAddedTextFor(trans)
            if (remainingText === '' || remainingText.startsWith(newTokenChar)) {
                this.suggestViaNonEpsilonLexerTransition(tokenSoFar, remainingText, newTokenChar, trans.target)
            }
        } else if (trans.serializationType === SET_TRANSITION) {
            const allLabelChars = _calcAllLabelChars(trans.label)
            for (let interval of trans.label.intervals) {
                for (let codePoint = interval.start; codePoint < interval.stop; ++codePoint) {
                    const ch = String.fromCodePoint(codePoint)
                    const shouldIgnoreCase = this.shouldIgnoreThisCase(ch, allLabelChars)
                    const newTokenChar = String.fromCodePoint(codePoint)
                    if (!shouldIgnoreCase && (remainingText === '' || remainingText.startsWith(newTokenChar))) {
                        this.suggestViaNonEpsilonLexerTransition(tokenSoFar, remainingText, newTokenChar, trans.target)
                    }
                }
            }
        }
    }

    suggestViaNonEpsilonLexerTransition(tokenSoFar, remainingText, newTokenChar, targetState) {
        const newRemainingText = (remainingText.length > 0) ? remainingText.substr(1) : ''
        this._suggest(tokenSoFar + newTokenChar, targetState, newRemainingText)
    }

    addSuggestedToken(tokenToAdd) {
        const justTheCompletionPart = this.chopOffCommonStart(tokenToAdd, this.origPartialToken)
        if (!this.suggestions.includes(justTheCompletionPart)) {
            this.suggestions.push(justTheCompletionPart)
        }
    }

    chopOffCommonStart(a: string, b: string) {
        const charsToChopOff = Math.min(a.length, b.length)
        return a.substring(charsToChopOff, a.length - charsToChopOff)
    }

    getAddedTextFor(transition: { label: number }) {
        return String.fromCodePoint(transition.label)
    }

    shouldIgnoreThisCase(transChar, allTransChars) {
        if (this.casePreference == null || this.casePreference === 'BOTH') {
            return false
        }
        const upper = transChar.toUpperCase()
        const lower = transChar.toLowerCase()
        switch(this.casePreference) {
        case 'LOWER':
            return transChar===upper && allTransChars.includes(lower)
        case 'UPPER':
            return transChar===lower && allTransChars.includes(upper)
        default:
            return false
        }
    }
}
const _calcAllLabelChars = (label: { intervals: any[] }) => {
    const allLabelChars = []
    for (let interval of label.intervals) {
        for (let codePoint = interval.start; codePoint < interval.stop; ++codePoint) {
            allLabelChars.push(String.fromCharCode(codePoint))
        }
    }
    return allLabelChars
}