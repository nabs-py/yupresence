import { useThemeStore } from "../stores/theme-store";

const colors = {
  black: "#111111",
  white: "#FFFFFF",
  grey50: "#F3F3F3",
  grey100: "#E9E9E9",
  grey200: "#D8D8D8",
  grey300: "#B8B8B8",
  grey400: "#939393",
  grey500: "#727272",
  grey600: "#555555",
  grey700: "#393939",
  grey800: "#242424",
  grey900: "#161616",
  orange: "#FF6A00",
  orangeSoft: "#FFF0E6",
  yellow: "#E7B400",
  red: "#D92D20",
  courseGreen: "#07963A",
  courseTeal: "#087F96",
  courseOlive: "#719400",
  courseGrey: "#555555",
  onAccent: "#FFFFFF",
  qrInk: "#000000"
} as const;

const darkColors = {
  black: "#FFFFFF",
  white: "#111111",
  grey50: "#303030",
  grey100: "#383838",
  grey200: "#484848",
  grey300: "#626262",
  grey400: "#858585",
  grey500: "#ABABAB",
  grey600: "#C8C8C8",
  grey700: "#E0E0E0",
  grey800: "#F0F0F0",
  grey900: "#FFFFFF",
  orange: "#FF6A00",
  orangeSoft: "#4A2B18",
  yellow: "#F5C842",
  red: "#FF665B",
  courseGreen: "#07963A",
  courseTeal: "#087F96",
  courseOlive: "#719400",
  courseGrey: "#666666",
  onAccent: "#FFFFFF",
  qrInk: "#000000"
} as const;

const fontFamily = {
  regular: "Inter-Regular",
  medium: "Inter-Medium",
  semibold: "Inter-SemiBold",
  bold: "Inter-Bold"
} as const;

type Palette = { [Key in keyof typeof colors]: string };

function createTheme(palette: Palette) {
  return {
  colors: palette,
  fontFamily,
  radius: {
    sm: 12,
    card: 24,
    control: 20,
    button: 9999
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
    xxxl: 48,
    huge: 64
  },
  typography: {
    hugeStat: {
      fontFamily: fontFamily.bold,
      fontSize: 52,
      lineHeight: 58
    },
    display: {
      fontFamily: fontFamily.bold,
      fontSize: 36,
      lineHeight: 42
    },
    heading: {
      fontFamily: fontFamily.semibold,
      fontSize: 24,
      lineHeight: 32
    },
    body: {
      fontFamily: fontFamily.regular,
      fontSize: 16,
      lineHeight: 24
    },
    label: {
      fontFamily: fontFamily.medium,
      fontSize: 13,
      lineHeight: 18
    }
  }
  } as const;
}

export const lightTheme = createTheme(colors);
export const darkTheme = createTheme(darkColors);
export const theme = lightTheme;

export type AppTheme = typeof lightTheme;

export function useAppTheme(): AppTheme {
  const isDark = useThemeStore((state) => state.isDark);
  return isDark ? darkTheme : lightTheme;
}
