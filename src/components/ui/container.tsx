import { cn } from "@/lib/utils";

const sizes = {
  sm: "max-w-3xl",
  md: "max-w-5xl",
  lg: "max-w-7xl",
} as const;

export interface ContainerProps extends React.ComponentProps<"div"> {
  size?: keyof typeof sizes;
}

export function Container({ size = "lg", className, ...props }: ContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", sizes[size], className)}
      {...props}
    />
  );
}
