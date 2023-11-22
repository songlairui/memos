import { Button, ButtonProps } from "@mui/joy";
import React, { forwardRef, useState } from "react";

export const LoadingButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "onClick"> & { onClick?: (e: React.MouseEvent) => Promise<any> | any }
>(function LoadingButton({ children, onClick, ...props }, ref) {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      ref={ref}
      {...props}
      loading={loading}
      onClick={
        onClick
          ? async (e) => {
              setLoading(true);
              try {
                await onClick?.(e);
              } catch (error) {
                console.debug("btn err", error);
              }
              setLoading(false);
            }
          : undefined
      }
    >
      {children}
    </Button>
  );
});
