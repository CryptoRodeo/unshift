import {
  List,
  ListItem,
  Icon,
} from "@patternfly/react-core";
import {
  CheckCircleIcon,
  OutlinedCircleIcon,
} from "@patternfly/react-icons";
import type { PrdEntry } from "../types";

export function PrdChecklist({ entries }: { entries: PrdEntry[] }) {
  return (
    <List isPlain>
      {entries.map((entry) => (
        <ListItem key={entry.id}>
          <Icon status={entry.completed ? "success" : undefined}>
            {entry.completed ? <CheckCircleIcon /> : <OutlinedCircleIcon />}
          </Icon>{" "}
          <strong>{entry.category}</strong>
          {entry.description && `: ${entry.description}`}
        </ListItem>
      ))}
    </List>
  );
}
