import {createRoot} from "react-dom/client";
import OpportunityWorkspace from "../components/opportunity-workspace.tsx";
import {demoRequest} from "./request.ts";
import "../app/globals.css";
import "../app/workspace.css";

createRoot(document.getElementById("root")!).render(
  <OpportunityWorkspace request={demoRequest} basePath="./" publicDemo/>
);
