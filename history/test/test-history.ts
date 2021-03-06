import ist from "ist"

import {EditorState, EditorSelection, SelectionRange, Transaction,
        StateEffect, StateEffectType, StateField, Mapping, Change} from "@codemirror/next/state"
import {isolateHistory, history, redo, redoDepth, redoSelection, undo, undoDepth,
        undoSelection, invertedEffects} from "@codemirror/next/history"

function mkState(config?: any, doc?: string) {
  return EditorState.create({
    extensions: [history(config), EditorState.allowMultipleSelections.of(true)],
    doc
  })
}

function type(state: EditorState, text: string, at = state.doc.length) {
  return state.t().replace(at, at, text).apply()
}
function timedType(state: EditorState, text: string, atTime: number) {
  return state.t(atTime).replace(state.doc.length, state.doc.length, text).apply()
}
function receive(state: EditorState, text: string, from: number, to = from) {
  return state.t().replace(from, to, text).annotate(Transaction.addToHistory, false).apply()
}
function command(state: EditorState, cmd: any, success: boolean = true) {
  ist(cmd({state, dispatch(tr: Transaction) { state = tr.apply() }}), success)
  return state
}

describe("history", () => {
  it("allows to undo a change", () => {
    let state = mkState()
    state = type(state, "newtext")
    state = command(state, undo)
    ist(state.doc.toString(), "")
  })

  it("allows to undo nearby changes in one change", () => {
    let state = mkState()
    state = type(state, "new")
    state = type(state, "text")
    state = command(state, undo)
    ist(state.doc.toString(), "")
  })

  it("allows to redo a change", () => {
    let state = mkState()
    state = type(state, "newtext")
    state = command(state, undo)
    state = command(state, redo)
    ist(state.doc.toString(), "newtext")
  })

  it("allows to redo nearby changes in one change", () => {
    let state = mkState()
    state = type(state, "new")
    state = type(state, "text")
    state = command(state, undo)
    state = command(state, redo)
    ist(state.doc.toString(), "newtext")
  })

  it("tracks multiple levels of history", () => {
    let state = mkState()
    state = type(state, "new")
    state = type(state, "text")
    state = type(state, "some", 0)
    ist(state.doc.toString(), "somenewtext")
    state = command(state, undo)
    ist(state.doc.toString(), "newtext")
    state = command(state, undo)
    ist(state.doc.toString(), "")
    state = command(state, redo)
    ist(state.doc.toString(), "newtext")
    state = command(state, redo)
    ist(state.doc.toString(), "somenewtext")
    state = command(state, undo)
    ist(state.doc.toString(), "newtext")
  })

  it("starts a new event when newGroupDelay elapses", () => {
    let state = mkState({newGroupDelay: 1000})
    state = timedType(state, "a", 1000)
    state = timedType(state, "b", 1600)
    ist(undoDepth(state), 1)
    state = timedType(state, "c", 2700)
    ist(undoDepth(state), 2)
    state = command(state, undo)
    state = timedType(state, "d", 2800)
    ist(undoDepth(state), 2)
  })

  it("allows changes that aren't part of the history", () => {
    let state = mkState()
    state = type(state, "hello")
    state = receive(state, "oops", 0)
    state = receive(state, "!", 9)
    state = command(state, undo)
    ist(state.doc.toString(), "oops!")
  })

  it("doesn't get confused by an undo not adding any redo item", () => {
    let state = mkState({}, "ab")
    state = type(state, "cd", 1)
    state = receive(state, "123", 0, 4)
    state = command(state, undo, false)
    command(state, redo, false)
  })

  it("accurately maps changes through each other", () => {
    let state = mkState({}, "123")
    state = state.t().replace(1, 2, "cd").replace(3, 4, "ef").replace(0, 1, "ab").apply()
    state = receive(state, "!!!!!!!!", 2, 2)
    state = command(state, undo)
    state = command(state, redo)
    ist(state.doc.toString(), "ab!!!!!!!!cdef")
  })

  it("can handle complex editing sequences", () => {
    let state = mkState()
    state = type(state, "hello")
    state = state.t().annotate(isolateHistory, "before").apply()
    state = type(state, "!")
    state = receive(state, "....", 0)
    state = type(state, "\n\n", 2)
    ist(state.doc.toString(), "..\n\n..hello!")
    state = receive(state, "\n\n", 1)
    state = command(state, undo)
    state = command(state, undo)
    ist(state.doc.toString(), ".\n\n...hello")
    state = command(state, undo)
    ist(state.doc.toString(), ".\n\n...")
  })

  it("supports overlapping edits", () => {
    let state = mkState()
    state = type(state, "hello")
    state = state.t().annotate(isolateHistory, "before").apply()
    state = state.t().replace(0, 5, "").apply()
    ist(state.doc.toString(), "")
    state = command(state, undo)
    ist(state.doc.toString(), "hello")
    state = command(state, undo)
    ist(state.doc.toString(), "")
  })

  it("supports overlapping edits that aren't collapsed", () => {
    let state = mkState()
    state = receive(state, "h", 0)
    state = type(state, "ello")
    state = state.t().annotate(isolateHistory, "before").apply()
    state = state.t().replace(0, 5, "").apply()
    ist(state.doc.toString(), "")
    state = command(state, undo)
    ist(state.doc.toString(), "hello")
    state = command(state, undo)
    ist(state.doc.toString(), "h")
  })

  it("supports overlapping unsynced deletes", () => {
    let state = mkState()
    state = type(state, "hi")
    state = state.t().annotate(isolateHistory, "before").apply()
    state = type(state, "hello")
    state = state.t().replace(0, 7, "").annotate(Transaction.addToHistory, false).apply()
    ist(state.doc.toString(), "")
    state = command(state, undo, false)
    ist(state.doc.toString(), "")
  })

  it("can go back and forth through history multiple times", () => {
    let state = mkState()
    state = type(state, "one")
    state = type(state, " two")
    state = state.t().annotate(isolateHistory, "before").apply()
    state = type(state, " three")
    state = type(state, "zero ", 0)
    state = state.t().annotate(isolateHistory, "before").apply()
    state = type(state, "\n\n", 0)
    state = type(state, "top", 0)
    for (let i = 0; i < 6; i++) {
      let re = i % 2
      for (let j = 0; j < 4; j++) state = command(state, re ? redo : undo)
      ist(state.doc.toString(), re ? "top\n\nzero one two three" : "")
    }
  })

  it("supports non-tracked changes next to tracked changes", () => {
    let state = mkState()
    state = type(state, "o")
    state = type(state, "\n\n", 0)
    state = receive(state, "zzz", 3)
    state = command(state, undo)
    ist(state.doc.toString(), "zzz")
  })

  it("can go back and forth through history when preserving items", () => {
    let state = mkState()
    state = type(state, "one")
    state = type(state, " two")
    state = state.t().annotate(isolateHistory, "before").apply()
    state = receive(state, "xxx", state.doc.length)
    state = type(state, " three")
    state = type(state, "zero ", 0)
    state = state.t().annotate(isolateHistory, "before").apply()
    state = type(state, "\n\n", 0)
    state = type(state, "top", 0)
    state = receive(state, "yyy", 0)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) state = command(state, undo)
      ist(state.doc.toString(), "yyyxxx")
      for (let j = 0; j < 4; j++) state = command(state, redo)
      ist(state.doc.toString(), "yyytop\n\nzero one twoxxx three")
    }
  })

  it("restores selection on undo", () => {
    let state = mkState()
    state = type(state, "hi")
    state = state.t().annotate(isolateHistory, "before").apply()
    state = state.t().setSelection(EditorSelection.single(0, 2)).apply()
    const selection = state.selection
    state = state.t().replaceSelection("hello").apply()
    const selection2 = state.selection
    state = command(state, undo)
    ist(state.selection.eq(selection))
    state = command(state, redo)
    ist(state.selection.eq(selection2))
  })

  it("restores the selection before the first change in an item (#46)", () => {
    let state = mkState()
    state = state.t().replace(0, 0, "a").setSelection(EditorSelection.single(1)).apply()
    state = state.t().replace(1, 1, "b").setSelection(EditorSelection.single(2)).apply()
    state = command(state, undo)
    ist(state.doc.toString(), "")
    ist(state.selection.primary.anchor, 0)
  })

  it("doesn't merge document changes if there's a selection change in between", () => {
    let state = mkState()
    state = type(state, "hi")
    state = state.t().setSelection(EditorSelection.single(0, 2)).apply()
    state = state.t().replaceSelection("hello").apply()
    ist(undoDepth(state), 2)
  })

  it("rebases selection on undo", () => {
    let state = mkState()
    state = type(state, "hi")
    state = state.t().annotate(isolateHistory, "before").apply()
    state = state.t().setSelection(EditorSelection.single(0, 2)).apply()
    state = type(state, "hello", 0)
    state = receive(state, "---", 0)
    state = command(state, undo)
    ist(state.selection.ranges[0].head, 5)
  })

  it("supports querying for the undo and redo depth", () => {
    let state = mkState()
    state = type(state, "a")
    ist(undoDepth(state), 1)
    ist(redoDepth(state), 0)
    state = receive(state, "b", 0)
    ist(undoDepth(state), 1)
    ist(redoDepth(state), 0)
    state = command(state, undo)
    ist(undoDepth(state), 0)
    ist(redoDepth(state), 1)
    state = command(state, redo)
    ist(undoDepth(state), 1)
    ist(redoDepth(state), 0)
  })

  it("all functions gracefully handle EditorStates without history", () => {
    let state = EditorState.create()
    ist(undoDepth(state), 0)
    ist(redoDepth(state), 0)
    command(state, undo, false)
    command(state, redo, false)
  })

  it("truncates history", () => {
    let state = mkState({minDepth: 10})
    for (let i = 0; i < 40; ++i) {
      state = type(state, "a")
      state = state.t().annotate(isolateHistory, "before").apply()
    }
    ist(undoDepth(state) < 40)
  })

  it("supports transactions with multiple changes", () => {
    let state = mkState()
    state = state.t().replace(0, 0, "a").replace(1, 1, "b").apply()
    state = type(state, "c", 0)
    ist(state.doc.toString(), "cab")
    state = command(state, undo)
    ist(state.doc.toString(), "ab")
    state = command(state, undo)
    ist(state.doc.toString(), "")
    state = command(state, redo)
    ist(state.doc.toString(), "ab")
    state = command(state, redo)
    ist(state.doc.toString(), "cab")
    state = command(state, undo)
    ist(state.doc.toString(), "ab")
  })

  it("doesn't undo selection-only transactions", () => {
    let state = mkState(undefined, "abc")
    ist(state.selection.primary.head, 0)
    state = state.t().setSelection(EditorSelection.single(2)).apply()
    state = command(state, undo, false)
    ist(state.selection.primary.head, 2)
  })

  it("isolates transactions when asked to", () => {
    let state = mkState()
    state = state.t().replace(0, 0, "a").annotate(isolateHistory, "after").apply()
    state = state.t().replace(1, 1, "b").apply()
    state = state.t().replace(2, 2, "c").annotate(isolateHistory, "after").apply()
    state = state.t().replace(3, 3, "d").apply()
    state = state.t().replace(4, 4, "e").annotate(isolateHistory, "full").apply()
    state = state.t().replace(5, 5, "f").apply()
    ist(undoDepth(state), 5)
  })

  it("can group events around a non-history transaction", () => {
    let state = mkState()
    state = state.t().replace(0, 0, "a").apply()
    state = state.t().replace(1, 1, "b").annotate(Transaction.addToHistory, false).apply()
    state = state.t().replace(1, 1, "c").apply()
    state = command(state, undo)
    ist(state.doc.toString(), "b")
  })

  it("survives compression", () => {
    let state = mkState()
    state = state.t().replace(0, 0, "a").apply()
    state = state.t().replace(1, 1, "b").annotate(Transaction.addToHistory, false).apply()
    state = state.t().replace(2, 2, "c").apply()
    state = state.t().replace(3, 3, "d").apply()
    state = state.t().replace(4, 4, "e").apply()
    state = state.t().replace(0, 0, ">").apply()
    for (let i = 0; i < 500; i++) state = state.t().replace(0, 0, "*").annotate(Transaction.addToHistory, false).apply()
    state = state.t().replace(0, 500, "=").annotate(Transaction.addToHistory, false).apply()
    ist(state.doc.toString(), "=>abcde")
    state = command(state, undo)
    state = command(state, undo)
    ist(state.doc.toString(), "=ab")
    state = command(state, undo)
    ist(state.doc.toString(), "=b")
    state = command(state, redo)
    state = command(state, redo)
    state = command(state, redo)
    ist(state.doc.toString(), "=>abcde")
  })

  describe("undoSelection", () => {
    it("allows to undo a change", () => {
      let state = mkState()
      state = type(state, "newtext")
      state = command(state, undoSelection)
      ist(state.doc.toString(), "")
    })

    it("allows to undo selection-only transactions", () => {
      let state = mkState(undefined, "abc")
      ist(state.selection.primary.head, 0)
      state = state.t().setSelection(EditorSelection.single(2)).apply()
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 0)
    })

    it("merges selection-only transactions from keyboard", () => {
      let state = mkState(undefined, "abc")
      ist(state.selection.primary.head, 0)
      state = state.t().setSelection(EditorSelection.single(2)).annotate(Transaction.userEvent, "keyboard").apply()
      state = state.t().setSelection(EditorSelection.single(3)).annotate(Transaction.userEvent, "keyboard").apply()
      state = state.t().setSelection(EditorSelection.single(1)).annotate(Transaction.userEvent, "keyboard").apply()
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 0)
    })

    it("doesn't merge selection-only transactions from other sources", () => {
      let state = mkState(undefined, "abc")
      ist(state.selection.primary.head, 0)
      state = state.t().setSelection(EditorSelection.single(2)).apply()
      state = state.t().setSelection(EditorSelection.single(3)).apply()
      state = state.t().setSelection(EditorSelection.single(1)).apply()
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 3)
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 2)
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 0)
    })

    it("doesn't merge selection-only transactions if they change the number of selections", () => {
      let state = mkState(undefined, "abc")
      ist(state.selection.primary.head, 0)
      state = state.t().setSelection(EditorSelection.single(2)).annotate(Transaction.userEvent, "keyboard").apply()
      state = state.t().setSelection(EditorSelection.create([new SelectionRange(1, 1), new SelectionRange(3, 3)])).
        annotate(Transaction.userEvent, "keyboard").apply()
      state = state.t().setSelection(EditorSelection.single(1)).annotate(Transaction.userEvent, "keyboard").apply()
      state = command(state, undoSelection)
      ist(state.selection.ranges.length, 2)
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 0)
    })

    it("doesn't merge selection-only transactions if a selection changes empty state", () => {
      let state = mkState(undefined, "abc")
      ist(state.selection.primary.head, 0)
      state = state.t().setSelection(EditorSelection.single(2)).annotate(Transaction.userEvent, "keyboard").apply()
      state = state.t().setSelection(EditorSelection.single(2, 3)).annotate(Transaction.userEvent, "keyboard").apply()
      state = state.t().setSelection(EditorSelection.single(1)).annotate(Transaction.userEvent, "keyboard").apply()
      state = command(state, undoSelection)
      ist(state.selection.primary.anchor, 2)
      ist(state.selection.primary.head, 3)
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 0)
    })

    it("allows to redo a change", () => {
      let state = mkState()
      state = type(state, "newtext")
      state = command(state, undoSelection)
      state = command(state, redoSelection)
      ist(state.doc.toString(), "newtext")
    })

    it("allows to redo selection-only transactions", () => {
      let state = mkState(undefined, "abc")
      ist(state.selection.primary.head, 0)
      state = state.t().setSelection(EditorSelection.single(2)).apply()
      state = command(state, undoSelection)
      state = command(state, redoSelection)
      ist(state.selection.primary.head, 2)
    })

    it("only changes selection", () => {
      let state = mkState()
      state = type(state, "hi")
      state = state.t().annotate(isolateHistory, "before").apply()
      const selection = state.selection
      state = state.t().setSelection(EditorSelection.single(0, 2)).apply()
      const selection2 = state.selection
      state = command(state, undoSelection)
      ist(state.selection.eq(selection))
      ist(state.doc.toString(), "hi")
      state = command(state, redoSelection)
      ist(state.selection.eq(selection2))
      state = state.t().replaceSelection("hello").apply()
      const selection3 = state.selection
      state = command(state, undoSelection)
      ist(state.selection.eq(selection2))
      state = command(state, redo)
      ist(state.selection.eq(selection3))
    })

    it("can undo a selection through remote changes", () => {
      let state = mkState()
      state = type(state, "hello")
      const selection = state.selection
      state = state.t().setSelection(EditorSelection.single(0, 2)).apply()
      state = receive(state, "oops", 0)
      state = receive(state, "!", 9)
      ist(state.selection.eq(EditorSelection.single(0, 6)))
      state = command(state, undoSelection)
      ist(state.doc.toString(), "oopshello!")
      ist(state.selection.eq(selection))
    })
  })

  describe("effects", () => {
    it("includes inverted effects in the history", () => {
      let set = StateEffect.define<number>()
      let field = StateField.define({
        create: () => 0,
        update(val, tr) {
          for (let effect of tr.effects) if (effect.is(set)) val = effect.value
          return val
        }
      })
      let invert = invertedEffects.of(tr => {
        for (let e of tr.effects) if (e.is(set)) return [set.of(tr.startState.field(field))]
        return []
      })
      let state = EditorState.create({extensions: [history(), field, invert]})
      state = state.t().effect(set.of(10)).annotate(isolateHistory, "before").apply()
      state = state.t().effect(set.of(20)).annotate(isolateHistory, "before").apply()
      ist(state.field(field), 20)
      state = command(state, undo)
      ist(state.field(field), 10)
      state = command(state, undo)
      ist(state.field(field), 0)
      state = command(state, redo)
      ist(state.field(field), 10)
      state = command(state, redo)
      ist(state.field(field), 20)
      state = command(state, undo)
      ist(state.field(field), 10)
      state = command(state, redo)
      ist(state.field(field), 20)
    })

    class Comment {
      constructor(readonly from: number,
                  readonly to: number,
                  readonly text: string) {}

      eq(other: Comment) { return this.from == other.from && this.to == other.to && this.text == other.text }
    }
    function mapComment(comment: Comment, mapping: Mapping) {
      let from = mapping.mapPos(comment.from, 1), to = mapping.mapPos(comment.to, -1)
      return from >= to ? undefined : new Comment(from, to, comment.text)
    }
    let addComment: StateEffectType<Comment> = StateEffect.define<Comment>({map: mapComment})
    let rmComment: StateEffectType<Comment> = StateEffect.define<Comment>({map: mapComment})
    let comments = StateField.define<Comment[]>({
      create: () => [],
      update(value, tr) {
        value = value.map(c => mapComment(c, tr.changes)).filter(x => x) as any
        for (let effect of tr.effects) {
          if (effect.is(addComment)) value = value.concat(effect.value)
          else if (effect.is(rmComment)) value = value.filter(c => !c.eq(effect.value))
        }
        return value.sort((a, b) => a.from - b.from)
      }
    })
    let invertComments = invertedEffects.of(tr => {
      let effects = []
      for (let effect of tr.effects) {
        if (effect.is(addComment) || effect.is(rmComment)) {
          let src = mapComment(effect.value, tr.invertedChanges())
          if (src) effects.push((effect.is(addComment) ? rmComment : addComment).of(src))
        }
      }
      for (let comment of tr.startState.field(comments)) {
        if (!mapComment(comment, tr.changes)) effects.push(addComment.of(comment))
      }
      return effects
    })

    function commentStr(state: EditorState) { return state.field(comments).map(c => c.text + "@" + c.from).join(",") }

    it("can map effects", () => {
      let state = EditorState.create({extensions: [history(), comments, invertComments],
                                      doc: "one two foo"})
      state = state.t().effect(addComment.of(new Comment(0, 3, "c1"))).annotate(isolateHistory, "full").apply()
      ist(commentStr(state), "c1@0")
      state = state.t().replace(3, 4, "---").annotate(isolateHistory, "full").
        effect(addComment.of(new Comment(6, 9, "c2"))).apply()
      ist(commentStr(state), "c1@0,c2@6")
      state = state.t().replace(0, 0, "---").annotate(Transaction.addToHistory, false).apply()
      ist(commentStr(state), "c1@3,c2@9")
      state = command(state, undo)
      ist(state.doc.toString(), "---one two foo")
      ist(commentStr(state), "c1@3")
      state = command(state, undo)
      ist(commentStr(state), "")
      state = command(state, redo)
      ist(commentStr(state), "c1@3")
      state = command(state, redo)
      ist(commentStr(state), "c1@3,c2@9")
      ist(state.doc.toString(), "---one---two foo")
      state = command(state, undo).t().replace(10, 11, "---").annotate(Transaction.addToHistory, false).apply()
      state = state.t().effect(addComment.of(new Comment(13, 16, "c3"))).annotate(isolateHistory, "full").apply()
      ist(commentStr(state), "c1@3,c3@13")
      state = command(state, undo)
      ist(state.doc.toString(), "---one two---foo")
      ist(commentStr(state), "c1@3")
      state = command(state, redo)
      ist(commentStr(state), "c1@3,c3@13")
    })

    it("can restore comments lost through deletion", () => {
      let state = EditorState.create({extensions: [history(), comments, invertComments],
                                      doc: "123456"})
      state = state.t().effect(addComment.of(new Comment(3, 5, "c1"))).annotate(isolateHistory, "full").apply()
      state = state.t().replace(2, 6, "").apply()
      ist(commentStr(state), "")
      state = command(state, undo)
      ist(commentStr(state), "c1@3")
    })
  })

  it("behaves properly with rebasing changes", () => {
    let state = EditorState.create({extensions: [history()], doc: "one three", selection: {anchor: 3}})
    let changes: {forward: Change, backward: Change}[] = []
    function dispatch(tr: Transaction) {
      for (let inv = tr.invertedChanges(), i = 0, j = inv.length - 1; j >= 0; i++, j--)
        changes.push({forward: tr.changes.changes[i], backward: inv.changes[j]})
      state = tr.apply()
    }
    function receive(confirmedTo: number, f: (tr: Transaction) => void) {
      let tr = state.t(), newChanges = changes.slice(0, confirmedTo)
      for (let i = changes.length - 1; i >= confirmedTo; i--) tr.changeNoFilter(changes[i].backward)
      f(tr)
      for (let i = confirmedTo, refIndex = changes.length - confirmedTo; i < changes.length; i++) {
        let mapped = changes[i].forward.map(tr.changes.partialMapping(refIndex))
        refIndex--
        if (mapped) {
          newChanges.push({forward: mapped, backward: mapped.invert(tr.doc)})
          tr.changeNoFilter(mapped, refIndex)
        }          
      }
      state = tr.annotate(Transaction.rebasedChanges, changes.length - confirmedTo)
        .annotate(Transaction.addToHistory, false).apply()
      changes = newChanges
    }

    for (let ch of " two") dispatch(state.t().replaceSelection(ch))
    dispatch(state.t().setSelection(13).replaceSelection("!"))
    ist(changes.length, 5)
    ist(state.doc.toString(), "one two three!")
    // Say the last 3 changes (adding "wo" and "!") are unconfirmed,
    // and remote changes come in replacing "three" -> "four"
    receive(2, tr => tr.replace(6, 11, "four"))
    ist(state.doc.toString(), "one two four!")
    // Another remote change, adding " five" after "four"
    receive(2, tr => tr.replace(10, 10, " five"))
    dispatch(state.t().replace(18, 18, "?").annotate(isolateHistory, "full"))
    ist(state.doc.toString(), "one two four five!?")

    undo({state, dispatch})
    ist(state.doc.toString(), "one two four five!")
    undo({state, dispatch})
    ist(state.doc.toString(), "one two four five")

    // Run through the full undo/redo to verify that still works, but
    // leave `state` at two undos
    let undone3 = command(state, undo)
    ist(undone3.doc.toString(), "one four five")
    let redone = command(undone3, redo), redone2 = command(redone, redo), redone3 = command(redone2, redo)
    ist(redone.doc.toString(), "one two four five")
    ist(redone2.doc.toString(), "one two four five!")
    ist(redone3.doc.toString(), "one two four five!?")

    receive(3, tr => tr.replace(16, 16, " six"))
    ist(state.doc.toString(), "one two four five six")
    undo({state, dispatch})
    ist(state.doc.toString(), "one four five six")
    redo({state, dispatch})
    ist(state.doc.toString(), "one two four five six")
    redo({state, dispatch})
    ist(state.doc.toString(), "one two four five six!")
    redo({state, dispatch})
    ist(state.doc.toString(), "one two four five six!?")
  })
})
