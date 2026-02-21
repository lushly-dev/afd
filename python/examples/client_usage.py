"""Example: Using the AFD CLI.

This script demonstrates how to use the AFD client library
to connect to and interact with MCP servers programmatically.
"""

import asyncio
from afd.transports import MockTransport, TransportConfig
from afd import success


async def main():
    """Demonstrate AFD client usage."""
    
    # ==============================================================================
    # Create a MockTransport for demonstration
    # ==============================================================================
    
    transport = MockTransport(
        config=TransportConfig(
            timeout_ms=5000,
        )
    )
    
    # Register some mock tools
    async def echo(args):
        return success({"message": args.get("text", "Hello!")})
    
    async def add_numbers(args):
        a = args.get("a", 0)
        b = args.get("b", 0)
        return success({"result": a + b})
    
    transport.register_tool(
        name="echo",
        handler=echo,
        description="Echo back a message",
    )
    
    transport.register_tool(
        name="math-add",
        handler=add_numbers,
        description="Add two numbers",
    )
    
    # ==============================================================================
    # Connect to the server
    # ==============================================================================
    
    print("Connecting to server...")
    await transport.connect()
    print(f"  State: {transport.state.value}")
    print()
    
    # ==============================================================================
    # List available tools
    # ==============================================================================
    
    print("Available tools:")
    tools = await transport.list_tools()
    for tool in tools:
        print(f"  - {tool.name}: {tool.description}")
    print()
    
    # ==============================================================================
    # Call tools
    # ==============================================================================
    
    print("Calling 'echo' tool...")
    result = await transport.call_tool("echo", {"text": "Hello, AFD!"})
    print(f"  Success: {result.success}")
    print(f"  Data: {result.data}")
    print()
    
    print("Calling 'math-add' tool...")
    result = await transport.call_tool("math-add", {"a": 42, "b": 58})
    print(f"  Success: {result.success}")
    print(f"  Data: {result.data}")
    print()
    
    # ==============================================================================
    # Call a non-existent tool (demonstrates error handling)
    # ==============================================================================
    
    print("Calling non-existent tool...")
    try:
        result = await transport.call_tool("does.not.exist", {})
        print(f"  Success: {result.success}")
    except Exception as e:
        print(f"  Error (expected): {type(e).__name__}: {e}")
    print()
    
    # ==============================================================================
    # View call history (MockTransport feature)
    # ==============================================================================
    
    print("Call history:")
    for call in transport.calls:
        print(f"  {call.tool_name}: {call.arguments}")
    print()
    
    # ==============================================================================
    # Disconnect
    # ==============================================================================
    
    print("Disconnecting...")
    await transport.disconnect()
    print(f"  State: {transport.state.value}")


if __name__ == "__main__":
    asyncio.run(main())
