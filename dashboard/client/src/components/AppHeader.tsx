import { useState, useEffect, useCallback } from "react";
import {
  Masthead,
  MastheadMain,
  MastheadBrand,
  MastheadContent,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Button,
} from "@patternfly/react-core";
import { SunIcon, MoonIcon } from "@patternfly/react-icons";

const DARK_MODE_KEY = "unshift-dark-mode";
const DARK_MODE_CLASS = "pf-v6-theme-dark";

function getInitialDarkMode(): boolean {
  const stored = localStorage.getItem(DARK_MODE_KEY);
  if (stored !== null) return stored === "true";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function AppHeader() {
  const [isDark, setIsDark] = useState(getInitialDarkMode);

  useEffect(() => {
    document.documentElement.classList.toggle(DARK_MODE_CLASS, isDark);
  }, [isDark]);

  const toggleDarkMode = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      localStorage.setItem(DARK_MODE_KEY, String(next));
      return next;
    });
  }, []);

  return (
    <Masthead>
      <MastheadMain>
        <MastheadBrand>
          <Title headingLevel="h1" size="xl">
            Unshift
          </Title>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar isFullHeight>
          <ToolbarContent>
            <ToolbarItem>
              <span style={{ color: "var(--pf-t--global--color--nonstatus--gray--text--200)" }}>
                Jira-to-PR Automation
              </span>
            </ToolbarItem>
            <ToolbarItem align={{ default: "alignEnd" }}>
              <Button
                variant="plain"
                aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                onClick={toggleDarkMode}
                icon={isDark ? <SunIcon /> : <MoonIcon />}
              />
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  );
}
