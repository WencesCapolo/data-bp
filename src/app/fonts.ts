import { IBM_Plex_Mono, Oswald, Poppins } from "next/font/google";

// The Portal's fonts, under the variables basket-tv-ui's tokens read. Shared by
// the root layout and global-error, which replaces it and brings its own <html>.
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["300", "400", "500", "600", "700", "800"], display: "swap" });
const oswald = Oswald({ variable: "--font-oswald", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const fontVariables = `${poppins.variable} ${oswald.variable} ${plexMono.variable}`;
