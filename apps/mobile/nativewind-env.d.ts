/// <reference types="nativewind/types" />

import "react-native";

// npm may install React Native beneath this workspace; augment that resolved copy.
declare module "react-native" {
  interface ViewProps {
    className?: string;
  }

  interface TextProps {
    className?: string;
  }
}
