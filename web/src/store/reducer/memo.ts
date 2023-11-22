import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { uniqBy } from "lodash-es";

export type LoadingStatus = "incomplete" | "fetching" | "complete";

interface State {
  loadingStatus: LoadingStatus;
  memos: Memo[];
  editing?: number;
}

const memoSlice = createSlice({
  name: "memo",
  initialState: {
    loadingStatus: "incomplete",
    memos: [],
  } as State,
  reducers: {
    updateLoadingStatus: (state, action: PayloadAction<LoadingStatus>) => {
      return {
        ...state,
        loadingStatus: action.payload,
      };
    },
    upsertMemos: (state, action: PayloadAction<Memo[]>) => {
      return {
        ...state,
        memos: uniqBy([...action.payload, ...state.memos], "id"),
      };
    },
    markEditing: (state, action: PayloadAction<number | undefined>) => {
      return {
        ...state,
        editing: action.payload,
      };
    },
    createMemo: (state, action: PayloadAction<Memo>) => {
      return {
        ...state,
        memos: state.memos.concat(action.payload),
      };
    },
    patchMemo: (state, action: PayloadAction<Partial<Memo>>) => {
      return {
        ...state,
        memos: state.memos
          .map((memo) => {
            if (memo.id === action.payload.id) {
              return {
                ...memo,
                ...action.payload,
              };
            } else {
              return memo;
            }
          })
          .filter((memo) => memo.rowStatus === "NORMAL"),
      };
    },
    deleteMemo: (state, action: PayloadAction<MemoId>) => {
      return {
        ...state,
        memos: state.memos.filter((memo) => {
          return memo.id !== action.payload;
        }),
      };
    },
  },
});

export const { updateLoadingStatus, upsertMemos, markEditing, createMemo, patchMemo, deleteMemo } = memoSlice.actions;

export default memoSlice.reducer;
