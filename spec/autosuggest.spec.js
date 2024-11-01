import autosuggest from '../autosuggest'

describe('Autosuggest', function () {
    class DummyObj {
        constructor(lexerCtr, parserCtr) {}
    }

    it('Should throw on lexer without ATN property', function () {
        let ctr = DummyObj.prototype.constructor;
        expect(() => {
            autosuggest.autosuggester(ctr, ctr);
        }).toThrow('Please use ANTLR4 version 4.7.1 or above.');
    });
});
