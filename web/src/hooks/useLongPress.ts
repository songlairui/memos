// copy from https://github.com/uidotdev/usehooks/blob/main/index.js#L664
import React from "react";

type Event = React.MouseEvent | React.TouchEvent;

function isTouchEvent({ nativeEvent }: Event) {
  return window.TouchEvent ? nativeEvent instanceof TouchEvent : "touches" in nativeEvent;
}

function isMouseEvent(event: Event) {
  return event.nativeEvent instanceof MouseEvent;
}

export type LongPressOptions = {
  threshold?: number;
  onStart?: (e: Event) => void;
  onFinish?: (e: Event) => void;
  onCancel?: (e: Event) => void;
};

export type LongPressFns = {
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  onMouseLeave: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
};

export function useLongPress(callback: (e: Event) => void, options: LongPressOptions = {}): LongPressFns {
  const { threshold = 400, onStart, onFinish, onCancel } = options;
  const isLongPressActive = React.useRef(false);
  const isPressed = React.useRef(false);
  const timerId = React.useRef<any>();

  return React.useMemo(() => {
    if (typeof callback !== "function") {
      return {} as any;
    }

    const start = (event: Event) => {
      if (!isMouseEvent(event) && !isTouchEvent(event)) return;

      if (onStart) {
        onStart(event);
      }

      isPressed.current = true;
      timerId.current = setTimeout(() => {
        callback(event);
        isLongPressActive.current = true;
      }, threshold);
    };

    const cancel = (event: Event) => {
      if (!isMouseEvent(event) && !isTouchEvent(event)) return;

      if (isLongPressActive.current) {
        if (onFinish) {
          onFinish(event);
        }
      } else if (isPressed.current) {
        if (onCancel) {
          onCancel(event);
        }
      }

      isLongPressActive.current = false;
      isPressed.current = false;

      if (timerId.current) {
        window.clearTimeout(timerId.current);
      }
    };

    const mouseHandlers = {
      onMouseDown: start,
      onMouseUp: cancel,
      onMouseLeave: cancel,
    };

    const touchHandlers = {
      onTouchStart: start,
      onTouchEnd: cancel,
    };

    return {
      ...mouseHandlers,
      ...touchHandlers,
    };
  }, [callback, threshold, onCancel, onFinish, onStart]);
}
