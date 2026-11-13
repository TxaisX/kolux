// The Base UI layer: one import path for every popup, tab set, select, switch and tooltip. See docs/base-ui-migration.md.
// Base UI itself is read on demand (part.ts), so importing from here adds only these small wrappers to a chunk.
export { Dialog, AlertDialog, type DialogProps } from "./Dialog";
export { Menu, ContextMenu, MenuItem, MenuCheckboxItem, MenuTitle, type MenuProps } from "./Menu";
export { Popover, type PopoverProps } from "./Popover";
export { Tooltip } from "./Tooltip";
export { Tabs, TabList, Tab, TabPanel } from "./Tabs";
export { Select, type SelectOption, type SelectProps } from "./Select";
export { Checkbox, Switch } from "./Switch";
export { useLayer, pointAnchor } from "./layer";
