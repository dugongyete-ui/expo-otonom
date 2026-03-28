import { ScrollView, ScrollViewProps } from "react-native";

type Props = ScrollViewProps & {
  keyboardShouldPersistTaps?: "always" | "never" | "handled";
  bottomOffset?: number;
  disableScrollOnKeyboardHide?: boolean;
};

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  bottomOffset: _bottomOffset,
  disableScrollOnKeyboardHide: _disableScrollOnKeyboardHide,
  ...props
}: Props) {
  return (
    <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
      {children}
    </ScrollView>
  );
}
