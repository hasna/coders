/**
 * DiffView — show file edit diffs inline
 *
 * Green for added lines (+), red for removed (-).
 * File path header, line numbers, collapsible for large diffs.
 */
import { Box, Text } from "ink";

interface DiffViewProps {
  filePath: string;
  oldString: string;
  newString: string;
  replacements: number;
}

export function DiffView({ filePath, oldString, newString, replacements }: DiffViewProps) {
  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>  ⎿ </Text>
        <Text bold>{filePath}</Text>
        <Text dimColor> ({replacements} replacement{replacements !== 1 ? "s" : ""})</Text>
      </Box>
      {oldLines.slice(0, 10).map((line, i) => (
        <Box key={`old-${i}`}>
          <Text dimColor>    </Text>
          <Text color="red">- {line}</Text>
        </Box>
      ))}
      {newLines.slice(0, 10).map((line, i) => (
        <Box key={`new-${i}`}>
          <Text dimColor>    </Text>
          <Text color="green">+ {line}</Text>
        </Box>
      ))}
      {(oldLines.length > 10 || newLines.length > 10) && (
        <Box>
          <Text dimColor>    ... ({Math.max(oldLines.length, newLines.length) - 10} more lines)</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Compact diff for tool result display
 */
export function CompactDiff({ diff }: { diff: string }) {
  if (!diff) return null;
  const lines = diff.split("\n").slice(0, 15);
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        const color = line.startsWith("+") ? "green"
          : line.startsWith("-") ? "red"
          : line.startsWith("@@") ? "cyan"
          : undefined;
        return (
          <Box key={i}>
            <Text dimColor>    </Text>
            <Text color={color} dimColor={!color}>{line}</Text>
          </Box>
        );
      })}
      {diff.split("\n").length > 15 && (
        <Box>
          <Text dimColor>    ... ({diff.split("\n").length - 15} more lines)</Text>
        </Box>
      )}
    </Box>
  );
}
