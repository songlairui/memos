import { Select, Option, Button, IconButton, Divider, Tooltip } from "@mui/joy";
import { isNumber, last, uniq, uniqBy } from "lodash-es";
import { AlertTriangleIcon } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useThrottleFn } from "react-use";
import useLocalStorage from "react-use/lib/useLocalStorage";
import { TAB_SPACE_WIDTH, UNKNOWN_ID, VISIBILITY_SELECTOR_ITEMS } from "@/helpers/consts";
import { clearContentQueryParam } from "@/helpers/utils";
import useCurrentUser from "@/hooks/useCurrentUser";
import { getMatchedNodes } from "@/labs/marked";
import { useFilterStore, useGlobalStore, useMemoStore, useResourceStore, useTagStore, useUserStore } from "@/store/module";
import { Resource } from "@/types/proto/api/v2/resource_service";
import { User_Role } from "@/types/proto/api/v2/user_service";
import { useTranslate } from "@/utils/i18n";
import showCreateMemoRelationDialog from "../CreateMemoRelationDialog";
import showCreateResourceDialog from "../CreateResourceDialog";
import Icon from "../Icon";
import VisibilityIcon from "../VisibilityIcon";
import TagSelector from "./ActionButton/TagSelector";
import Editor, { EditorRefActions } from "./Editor";
import { LoadingButton } from "./LoadingButton";
import RelationListView from "./RelationListView";
import ResourceListView from "./ResourceListView";

const listItemSymbolList = ["- [ ] ", "- [x] ", "- [X] ", "* ", "- "];
const emptyOlReg = /^(\d+)\. $/;

interface Props {
  className?: string;
  editorClassName?: string;
  cacheKey?: string;
  memoId?: MemoId;
  relationList?: MemoRelation[];
  onConfirm?: () => void;
  enableContinueEditing?: boolean;
  enableAutoSave?: boolean;
}

interface State {
  memoVisibility: Visibility;
  resourceList: Resource[];
  relationList: MemoRelation[];
  isUploadingResource: boolean;
  isRequesting: boolean;
}

const MemoEditor = (props: Props) => {
  const { className, editorClassName, cacheKey, memoId, onConfirm, enableContinueEditing, enableAutoSave } = props;
  const { i18n } = useTranslation();
  const t = useTranslate();
  const contentCacheKey = `memo-editor-${cacheKey}`;
  const [contentCache, setContentCache] = useLocalStorage<string>(contentCacheKey, "");
  const {
    state: { systemStatus },
  } = useGlobalStore();
  const userStore = useUserStore();
  const filterStore = useFilterStore();
  const memoStore = useMemoStore();
  const tagStore = useTagStore();
  const resourceStore = useResourceStore();
  const currentUser = useCurrentUser();
  const [state, setState] = useState<State>({
    memoVisibility: "PRIVATE",
    resourceList: [],
    relationList: props.relationList ?? [],
    isUploadingResource: false,
    isRequesting: false,
  });
  const [hasContent, setHasContent] = useState<boolean>(false);
  const [isInIME, setIsInIME] = useState(false);
  const editorRef = useRef<EditorRefActions>(null);
  const user = userStore.state.user as User;
  const setting = user.setting;
  const referenceRelations = memoId
    ? state.relationList.filter(
        (relation) => relation.memoId === memoId && relation.relatedMemoId !== memoId && relation.type === "REFERENCE"
      )
    : state.relationList.filter((relation) => relation.type === "REFERENCE");

  useEffect(() => {
    editorRef.current?.setContent(contentCache || "");
    handleEditorFocus();
  }, []);

  useEffect(() => {
    let visibility = setting.memoVisibility;
    if (systemStatus.disablePublicMemos && visibility === "PUBLIC") {
      visibility = "PRIVATE";
    }
    setState((prevState) => ({
      ...prevState,
      memoVisibility: visibility,
    }));
  }, [setting.memoVisibility, systemStatus.disablePublicMemos]);

  useEffect(() => {
    if (memoId) {
      memoStore.getMemoById(memoId ?? UNKNOWN_ID).then((memo) => {
        if (memo) {
          handleEditorFocus();
          setState((prevState) => ({
            ...prevState,
            memoVisibility: memo.visibility,
            resourceList: memo.resourceList,
            relationList: memo.relationList,
          }));
          if (!contentCache) {
            editorRef.current?.setContent(memo.content ?? "");
          }
        }
      });
    }
  }, [memoId]);

  const { count, loading, error, invokeChange, flush } = useThrottleSave<Memo>(enableAutoSave, {
    // 获取初始数据
    getInitial() {
      if (!memoId || memoId === UNKNOWN_ID) {
        return;
      }
      // 检查缓存中是否存在 - 没有则直接返回 - 不自动保存
      return memoStore.getState().memos.find((item) => item.id === memoId);
    },
    // 获取当前数据
    getCurrent() {
      const content = editorRef.current?.getContent() ?? "";
      return {
        content,
        visibility: state.memoVisibility,
        resourceIdList: state.resourceList.map((resource) => resource.id),
        relationList: state.relationList,
      };
    },
    // 检查是否变更
    checkChange(current, prev) {
      return current.content?.trim() !== prev.content?.trim();
    },
    // 保存变更
    async saveFn(editing, prevMemo) {
      setState((state) => {
        return {
          ...state,
          isRequesting: true,
        };
      });
      let _err: Error | undefined = undefined;
      try {
        await memoStore.patchMemo({
          ...editing,
          id: prevMemo.id,
        });

        // Upsert tag with the content.
        const matchedNodes = getMatchedNodes(editing.content!);
        const tagNameList = uniq(matchedNodes.filter((node) => node.parserName === "tag").map((node) => node.matchedContent.slice(1)));
        for (const tagName of tagNameList) {
          await tagStore.upsertTag(tagName);
        }
      } catch (error: any) {
        _err = error;
      }

      setState((state) => {
        return {
          ...state,
          isRequesting: false,
        };
      });
      if (_err) {
        throw _err;
      }
      //
    },
  });

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!editorRef.current) {
      return;
    }

    const isMetaKey = event.ctrlKey || event.metaKey;
    if (isMetaKey) {
      if (event.key === "Enter") {
        handleSaveBtnClick();
        return;
      }
    }
    if (event.key === "Enter" && !isInIME) {
      const cursorPosition = editorRef.current.getCursorPosition();
      const contentBeforeCursor = editorRef.current.getContent().slice(0, cursorPosition);
      const rowValue = last(contentBeforeCursor.split("\n"));
      if (rowValue) {
        if (listItemSymbolList.includes(rowValue) || emptyOlReg.test(rowValue)) {
          event.preventDefault();
          editorRef.current.removeText(cursorPosition - rowValue.length, rowValue.length);
        } else {
          // unordered/todo list
          let matched = false;
          for (const listItemSymbol of listItemSymbolList) {
            if (rowValue.startsWith(listItemSymbol)) {
              event.preventDefault();
              editorRef.current.insertText("", `\n${listItemSymbol}`);
              matched = true;
              break;
            }
          }

          if (!matched) {
            // ordered list
            const olMatchRes = /^(\d+)\. /.exec(rowValue);
            if (olMatchRes) {
              const order = parseInt(olMatchRes[1]);
              if (isNumber(order)) {
                event.preventDefault();
                editorRef.current.insertText("", `\n${order + 1}. `);
              }
            }
          }
          editorRef.current?.scrollToCursor();
        }
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const tabSpace = " ".repeat(TAB_SPACE_WIDTH);
      const cursorPosition = editorRef.current.getCursorPosition();
      const selectedContent = editorRef.current.getSelectedContent();
      editorRef.current.insertText(tabSpace);
      if (selectedContent) {
        editorRef.current.setCursorPosition(cursorPosition + TAB_SPACE_WIDTH);
      }
      return;
    }
  };

  const handleMemoVisibilityChange = (visibility: Visibility) => {
    setState((prevState) => ({
      ...prevState,
      memoVisibility: visibility,
    }));
  };

  const handleUploadFileBtnClick = () => {
    showCreateResourceDialog({
      onConfirm: (resourceList) => {
        setState((prevState) => ({
          ...prevState,
          resourceList: [...prevState.resourceList, ...resourceList],
        }));
      },
    });
  };

  const handleAddMemoRelationBtnClick = () => {
    showCreateMemoRelationDialog({
      onConfirm: (memoIdList) => {
        setState((prevState) => ({
          ...prevState,
          relationList: uniqBy(
            [
              ...memoIdList.map((id) => ({ memoId: memoId || UNKNOWN_ID, relatedMemoId: id, type: "REFERENCE" as MemoRelationType })),
              ...state.relationList,
            ].filter((relation) => relation.relatedMemoId !== (memoId || UNKNOWN_ID)),
            "relatedMemoId"
          ),
        }));
      },
    });
  };

  const handleSetResourceList = (resourceList: Resource[]) => {
    setState((prevState) => ({
      ...prevState,
      resourceList,
    }));
  };

  const handleSetRelationList = (relationList: MemoRelation[]) => {
    setState((prevState) => ({
      ...prevState,
      relationList,
    }));
  };

  const handleUploadResource = async (file: File) => {
    setState((state) => {
      return {
        ...state,
        isUploadingResource: true,
      };
    });

    let resource = undefined;
    try {
      resource = await resourceStore.createResourceWithBlob(file);
    } catch (error: any) {
      console.error(error);
      toast.error(typeof error === "string" ? error : error.response.data.message);
    }

    setState((state) => {
      return {
        ...state,
        isUploadingResource: false,
      };
    });
    invokeChange();
    return resource;
  };

  const uploadMultiFiles = async (files: FileList) => {
    const uploadedResourceList: Resource[] = [];
    for (const file of files) {
      const resource = await handleUploadResource(file);
      if (resource) {
        uploadedResourceList.push(resource);
        if (memoId) {
          await resourceStore.updateResource({
            resource: Resource.fromPartial({
              id: resource.id,
              memoId,
            }),
            updateMask: ["memo_id"],
          });
        }
      }
    }
    if (uploadedResourceList.length > 0) {
      setState((prevState) => ({
        ...prevState,
        resourceList: [...prevState.resourceList, ...uploadedResourceList],
      }));
      invokeChange();
    }
  };

  const handleDropEvent = async (event: React.DragEvent) => {
    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      event.preventDefault();
      await uploadMultiFiles(event.dataTransfer.files);
    }
  };

  const handlePasteEvent = async (event: React.ClipboardEvent) => {
    if (event.clipboardData && event.clipboardData.files.length > 0) {
      event.preventDefault();
      await uploadMultiFiles(event.clipboardData.files);
    }
  };

  const handleContentChange = (content: string) => {
    setHasContent(content !== "");
    if (content !== "") {
      setContentCache(content);
      invokeChange();
    } else {
      localStorage.removeItem(contentCacheKey);
    }
  };

  const handleSaveBtnClick = async (
    /* 标记创建, 创建之后继续编辑 */
    markCreate?: boolean
  ) => {
    if (state.isRequesting) {
      return;
    }
    flush();
    setState((state) => {
      return {
        ...state,
        isRequesting: true,
      };
    });
    const content = editorRef.current?.getContent() ?? "";

    try {
      if (memoId && memoId !== UNKNOWN_ID) {
        const prevMemo = await memoStore.getMemoById(memoId ?? UNKNOWN_ID);

        if (prevMemo) {
          await memoStore.patchMemo({
            id: prevMemo.id,
            content,
            visibility: state.memoVisibility,
            resourceIdList: state.resourceList.map((resource) => resource.id),
            relationList: state.relationList,
          });
        }
      } else {
        await memoStore.createMemo(
          {
            content,
            visibility: state.memoVisibility,
            resourceIdList: state.resourceList.map((resource) => resource.id),
            relationList: state.relationList,
          },
          markCreate
        );
        filterStore.clearFilter();
      }
      editorRef.current?.setContent("");
      clearContentQueryParam();
    } catch (error: any) {
      console.error(error);
      toast.error(error.response.data.message);
    }
    setState((state) => {
      return {
        ...state,
        isRequesting: false,
      };
    });

    // Upsert tag with the content.
    const matchedNodes = getMatchedNodes(content);
    const tagNameList = uniq(matchedNodes.filter((node) => node.parserName === "tag").map((node) => node.matchedContent.slice(1)));
    for (const tagName of tagNameList) {
      await tagStore.upsertTag(tagName);
    }

    setState((prevState) => ({
      ...prevState,
      resourceList: [],
    }));
    if (onConfirm) {
      onConfirm();
    }
  };

  const handleCheckBoxBtnClick = () => {
    if (!editorRef.current) {
      return;
    }
    const currentPosition = editorRef.current?.getCursorPosition();
    const currentLineNumber = editorRef.current?.getCursorLineNumber();
    const currentLine = editorRef.current?.getLine(currentLineNumber);
    let newLine = "";
    let cursorChange = 0;
    if (/^- \[( |x|X)\] /.test(currentLine)) {
      newLine = currentLine.replace(/^- \[( |x|X)\] /, "");
      cursorChange = -6;
    } else if (/^\d+\. |- /.test(currentLine)) {
      const match = currentLine.match(/^\d+\. |- /) ?? [""];
      newLine = currentLine.replace(/^\d+\. |- /, "- [ ] ");
      cursorChange = -match[0].length + 6;
    } else {
      newLine = "- [ ] " + currentLine;
      cursorChange = 6;
    }
    editorRef.current?.setLine(currentLineNumber, newLine);
    editorRef.current.setCursorPosition(currentPosition + cursorChange);
    editorRef.current?.scrollToCursor();
  };

  const handleCodeBlockBtnClick = () => {
    if (!editorRef.current) {
      return;
    }

    const cursorPosition = editorRef.current.getCursorPosition();
    const prevValue = editorRef.current.getContent().slice(0, cursorPosition);
    if (prevValue === "" || prevValue.endsWith("\n")) {
      editorRef.current?.insertText("", "```\n", "\n```");
    } else {
      editorRef.current?.insertText("", "\n```\n", "\n```");
    }
    editorRef.current?.scrollToCursor();
  };

  const handleTagSelectorClick = useCallback((tag: string) => {
    editorRef.current?.insertText(`#${tag} `);
    invokeChange();
  }, []);

  const handleEditorFocus = () => {
    editorRef.current?.focus();
  };

  const editorConfig = useMemo(
    () => ({
      className: editorClassName ?? "",
      initialContent: "",
      placeholder: t("editor.placeholder"),
      onContentChange: handleContentChange,
      onPaste: handlePasteEvent,
    }),
    [i18n.language]
  );

  const allowSave = (hasContent || state.resourceList.length > 0) && !state.isUploadingResource && !state.isRequesting;

  const disableOption = (v: string) => {
    const isAdminOrHost = currentUser.role === User_Role.ADMIN || currentUser.role === User_Role.HOST;

    if (v === "PUBLIC" && !isAdminOrHost) {
      return systemStatus.disablePublicMemos;
    }
    return false;
  };

  return (
    <div
      className={`${
        className ?? ""
      } relative w-full flex flex-col justify-start items-start bg-white dark:bg-zinc-700 px-4 pt-4 rounded-lg border-2 border-gray-200 dark:border-zinc-600`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onDrop={handleDropEvent}
      onFocus={handleEditorFocus}
      onCompositionStart={() => setIsInIME(true)}
      onCompositionEnd={() => setIsInIME(false)}
    >
      <Editor ref={editorRef} {...editorConfig} />
      <div className="relative w-full flex flex-row justify-between items-center pt-2 z-1">
        <div className="flex flex-row justify-start items-center">
          <TagSelector onTagSelectorClick={(tag) => handleTagSelectorClick(tag)} />
          <IconButton
            className="flex flex-row justify-center items-center p-1 w-auto h-auto mr-1 select-none rounded cursor-pointer text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-zinc-800 hover:shadow"
            onClick={handleUploadFileBtnClick}
          >
            <Icon.Image className="w-5 h-5 mx-auto" />
          </IconButton>
          <IconButton
            className="flex flex-row justify-center items-center p-1 w-auto h-auto mr-1 select-none rounded cursor-pointer text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-zinc-800 hover:shadow"
            onClick={handleAddMemoRelationBtnClick}
          >
            <Icon.Link className="w-5 h-5 mx-auto" />
          </IconButton>
          <IconButton
            className="flex flex-row justify-center items-center p-1 w-auto h-auto mr-1 select-none rounded cursor-pointer text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-zinc-800 hover:shadow"
            onClick={handleCheckBoxBtnClick}
          >
            <Icon.CheckSquare className="w-5 h-5 mx-auto" />
          </IconButton>
          <IconButton
            className="flex flex-row justify-center items-center p-1 w-auto h-auto mr-1 select-none rounded cursor-pointer text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-zinc-800 hover:shadow"
            onClick={handleCodeBlockBtnClick}
          >
            <Icon.Code className="w-5 h-5 mx-auto" />
          </IconButton>
        </div>
      </div>
      <ResourceListView resourceList={state.resourceList} setResourceList={handleSetResourceList} />
      <RelationListView relationList={referenceRelations} setRelationList={handleSetRelationList} />
      <Divider className="!mt-2" />
      <div className="w-full flex flex-row justify-between items-center py-3 dark:border-t-zinc-500">
        <div className="relative flex flex-row justify-start items-center" onFocus={(e) => e.stopPropagation()}>
          <Select
            variant="plain"
            value={state.memoVisibility}
            startDecorator={<VisibilityIcon visibility={state.memoVisibility} />}
            onChange={(_, visibility) => {
              if (visibility) {
                handleMemoVisibilityChange(visibility);
              }
            }}
          >
            {VISIBILITY_SELECTOR_ITEMS.map((item) => (
              <Option key={item} value={item} className="whitespace-nowrap" disabled={disableOption(item)}>
                {t(`memo.visibility.${item.toLowerCase() as Lowercase<typeof item>}`)}
              </Option>
            ))}
          </Select>
        </div>
        <div className="shrink-0 flex gap-2 flex-row justify-end items-center">
          {!error && enableAutoSave && (Boolean(count) || loading) && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              <span>{loading ? "自动保存中" : "即将自动保存"}</span>
              <span>{`${".".repeat(count + 1)}`}</span>
            </span>
          )}
          {error && (
            <Tooltip title="Auto Save Error" placement="top">
              <IconButton
                size="sm"
                onClick={async () => {
                  invokeChange();
                }}
              >
                <AlertTriangleIcon />
              </IconButton>
            </Tooltip>
          )}
          {enableContinueEditing && (
            <LoadingButton disabled={!allowSave} onClick={() => handleSaveBtnClick(true)}>
              {"保存并继续编辑"}
            </LoadingButton>
          )}
          <Button color="success" disabled={!allowSave} loading={loading} onClick={() => handleSaveBtnClick(false)}>
            {t("editor.save")}
          </Button>
        </div>
      </div>
    </div>
  );
};

/** 6s 一保存 */
function useThrottleSave<T extends { [key: string]: any }>(
  enable: boolean | undefined,
  {
    getInitial,
    getCurrent,
    checkChange,
    saveFn,
  }: {
    getInitial(): T | undefined;
    getCurrent(prev: T): Partial<T>;
    checkChange(cur: Partial<T>, prev: T): boolean;
    saveFn(val: Partial<T>, old: T): any | Promise<any>;
  }
) {
  const [val, setVal] = useState<Partial<T> | undefined>(getInitial());
  const [count, setCount] = useState(0); // 计时
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error>();
  const timer = useRef<any>();

  async function exec(value: Partial<T>) {
    if (loading) {
      return;
    }
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = undefined;
    }
    setLoading(true);
    try {
      await saveFn(value, getInitial()!);
      setError(undefined);
    } catch (error: any) {
      setError(error);
    }

    setCount(0);
    setLoading(false);
  }

  const noopExec: typeof exec = () => Promise.resolve();

  const activeExec = useRef(noopExec);

  useThrottleFn(
    (value) => {
      if (value === getInitial()) {
        return;
      }
      activeExec.current(value!);
    },
    6 * 1000,
    [val]
  );

  function invokeChange() {
    if (enable) {
      const initial = getInitial();
      if (!initial) {
        return;
      }
      const current = getCurrent(initial);
      const isChanged = checkChange(current, initial);
      if (!isChanged) {
        return;
      }

      activeExec.current = exec;
      setVal(current);
      setCount((prev) => Math.max(1, prev));
      if (!timer.current) {
        timer.current = setInterval(() => {
          setCount((prev) => prev + 1);
        }, 1000);
      }
    }
  }
  function flush() {
    activeExec.current = noopExec;
    setCount(0);
    if (timer.current) {
      clearInterval(timer.current);
    }
  }
  return {
    count,
    error,
    loading,
    invokeChange,
    flush,
    retry() {
      return exec(getCurrent(getInitial()!));
    },
  };
}

export default MemoEditor;
