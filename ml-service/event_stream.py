"""Incremental event grouping: close an event as soon as its end is known.

restructure.restructure_xml_to_events() needs every boundary before it can
return anything. EventSplitter does the same grouping while boundary decisions
arrive in order, so annotation of an event can start the moment the next
boundary shows where it ends.
"""

import io
import xml.etree.ElementTree as ET
from typing import Optional


class EventSplitter:
    """Group the children of a flat <recording> into <event> blocks, streaming.

    Feed it every timestamped chunk in order with `advance`. A chunk flagged as
    a new event closes the event before it. Chunks map to children by order, so
    repeated timestamps split only where the model said so.
    """

    def __init__(self, flat_xml: str) -> None:
        root = ET.parse(io.StringIO(flat_xml)).getroot()
        self._tag = root.tag
        self._attrib = dict(root.attrib)
        self._children = list(root)
        self._start = 0   # first child of the open event
        self._cursor = 0  # next child not yet matched to a chunk

    def advance(self, timestamp: str, is_new_event: bool) -> Optional[str]:
        """Consume the next chunk; return the XML of an event it just closed."""
        position = next(
            (i for i in range(self._cursor, len(self._children)) if self._children[i].get("timestamp") == timestamp),
            None,
        )
        if position is None:
            return None
        self._cursor = position + 1
        if not is_new_event or position <= self._start:
            return None
        closed = self._serialize(self._start, position)
        self._start = position
        return closed

    def finish(self) -> Optional[str]:
        """Close the last open event; None when the recording had no children."""
        if self._start >= len(self._children):
            return None
        closed = self._serialize(self._start, len(self._children))
        self._start = len(self._children)
        return closed

    def _serialize(self, first: int, stop: int) -> str:
        event = ET.Element("event")
        event.extend(self._children[first:stop])
        wrapper = ET.Element(self._tag, self._attrib)
        wrapper.append(event)
        ET.indent(wrapper, space="  ", level=0)
        return ET.tostring(event, encoding="unicode").strip()
