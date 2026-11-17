"""`python -m stream_gateway` runs the gateway; `python -m stream_gateway login` logs the account in."""
import asyncio
import sys

if sys.argv[1:] == ["login"]:
    from .login import login
    asyncio.run(login())
else:
    from .main import main
    main()
