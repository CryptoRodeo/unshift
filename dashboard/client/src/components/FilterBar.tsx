import { useState, useEffect, useMemo } from "react";
import {
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  ToolbarFilter,
  ToolbarGroup,
  SearchInput,
  ToggleGroup,
  ToggleGroupItem,
  Select,
  SelectOption,
  SelectList,
  MenuToggle,
  Button,
  Badge,
} from "@patternfly/react-core";
import { FilterIcon, TimesIcon } from "@patternfly/react-icons";
import type { Run } from "../types";
import type { StatusFilter } from "../hooks/useRunFilters";
import { getRepoName } from "../hooks/useRunFilters";

interface FilterBarProps {
  query: string;
  statuses: Set<StatusFilter>;
  repo: string | null;
  hasFilters: boolean;
  setQuery: (q: string) => void;
  toggleStatus: (s: StatusFilter) => void;
  setRepo: (r: string | null) => void;
  clearAll: () => void;
  runs: Run[];
  totalCount: number;
  filteredCount: number;
}

const STATUS_TOGGLE_ITEMS: { key: StatusFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "awaiting_approval", label: "Awaiting Approval" },
  { key: "succeeded", label: "Succeeded" },
  { key: "failed", label: "Failed" },
];

export function FilterBar({
  query,
  statuses,
  repo,
  hasFilters,
  setQuery,
  toggleStatus,
  setRepo,
  clearAll,
  runs,
  totalCount,
  filteredCount,
}: FilterBarProps) {
  const [localQuery, setLocalQuery] = useState(query);
  const [repoOpen, setRepoOpen] = useState(false);

  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localQuery !== query) setQuery(localQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [localQuery, query, setQuery]);

  const repos = useMemo(() => {
    const set = new Set<string>();
    for (const run of runs) {
      const name = getRepoName(run);
      if (name) set.add(name);
    }
    return Array.from(set).sort();
  }, [runs]);

  return (
    <Toolbar clearAllFilters={clearAll}>
      <ToolbarContent>
        <ToolbarItem>
          <SearchInput
            placeholder="Filter by issue key..."
            value={localQuery}
            onChange={(_e, value) => setLocalQuery(value)}
            onClear={() => {
              setLocalQuery("");
              setQuery("");
            }}
          />
        </ToolbarItem>

        <ToolbarGroup variant="filter-group">
          <ToolbarFilter
            categoryName="Status"
            chips={Array.from(statuses).map(
              (s) =>
                STATUS_TOGGLE_ITEMS.find((i) => i.key === s)?.label ?? s
            )}
            deleteChip={(_cat, chip) => {
              const item = STATUS_TOGGLE_ITEMS.find(
                (i) => i.label === chip
              );
              if (item) toggleStatus(item.key);
            }}
            deleteChipGroup={() => {
              for (const s of statuses) toggleStatus(s);
            }}
          >
            <ToggleGroup aria-label="Status filter">
              {STATUS_TOGGLE_ITEMS.map((item) => (
                <ToggleGroupItem
                  key={item.key}
                  text={item.label}
                  isSelected={statuses.has(item.key)}
                  onChange={() => toggleStatus(item.key)}
                />
              ))}
            </ToggleGroup>
          </ToolbarFilter>
        </ToolbarGroup>

        {repos.length > 0 && (
          <ToolbarItem>
            <Select
              isOpen={repoOpen}
              onOpenChange={setRepoOpen}
              toggle={(toggleRef) => (
                <MenuToggle
                  ref={toggleRef}
                  onClick={() => setRepoOpen(!repoOpen)}
                  isExpanded={repoOpen}
                  icon={<FilterIcon />}
                >
                  {repo ?? "All repos"}
                </MenuToggle>
              )}
              onSelect={(_e, value) => {
                setRepo(value === "__all__" ? null : (value as string));
                setRepoOpen(false);
              }}
              selected={repo ?? "__all__"}
            >
              <SelectList>
                <SelectOption value="__all__">All repos</SelectOption>
                {repos.map((r) => (
                  <SelectOption key={r} value={r}>
                    {r}
                  </SelectOption>
                ))}
              </SelectList>
            </Select>
          </ToolbarItem>
        )}

        {hasFilters && (
          <>
            <ToolbarItem>
              <Badge isRead>
                {filteredCount} of {totalCount} runs
              </Badge>
            </ToolbarItem>
            <ToolbarItem>
              <Button
                variant="link"
                onClick={clearAll}
                icon={<TimesIcon />}
              >
                Clear filters
              </Button>
            </ToolbarItem>
          </>
        )}
      </ToolbarContent>
    </Toolbar>
  );
}
