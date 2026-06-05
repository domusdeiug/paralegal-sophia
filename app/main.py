from google.adk.runners import ConsoleRunner
from agent import orchestrator_agent

if __name__ == '__main__':
    runner = ConsoleRunner(agent=orchestrator_agent)
    runner.run()
