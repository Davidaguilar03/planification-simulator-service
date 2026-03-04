package co.edu.uptc.planification_model_service.services.algorithms;

import co.edu.uptc.planification_model_service.models.SimulationConfig;
import co.edu.uptc.planification_model_service.models.SimulationProcess;
import co.edu.uptc.planification_model_service.models.TickSnapshot;

import java.util.List;

public interface SchedulingAlgorithm {
    void initialize(List<SimulationProcess> processes, SimulationConfig config);
    TickSnapshot tick(int currentTick);
    boolean isFinished();
    List<SimulationProcess> getProcesses();
    int getBusyTicks();
}

