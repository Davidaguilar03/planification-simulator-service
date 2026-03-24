package co.edu.uptc.planification_model_service.models;

import co.edu.uptc.planification_model_service.models.enums.SimulationState;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SimulationResult {
    private String simulationId;
    private SimulationConfig config;
    private SimulationState state;
    private int currentTick;
    private List<SimulationStats> stats;
    private Map<String, List<TickSnapshot>> tickHistory;
}

