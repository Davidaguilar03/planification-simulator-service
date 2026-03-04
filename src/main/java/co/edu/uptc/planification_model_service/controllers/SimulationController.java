package co.edu.uptc.planification_model_service.controllers;

import co.edu.uptc.planification_model_service.models.SimulationConfig;
import co.edu.uptc.planification_model_service.models.SimulationResult;
import co.edu.uptc.planification_model_service.models.TickSnapshot;
import co.edu.uptc.planification_model_service.models.enums.AlgorithmType;
import co.edu.uptc.planification_model_service.models.enums.SimulationState;
import co.edu.uptc.planification_model_service.services.SimulationEngine;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/simulations")
public class SimulationController {

    private final SimulationEngine simulationEngine;

    public SimulationController(SimulationEngine simulationEngine) {
        this.simulationEngine = simulationEngine;
    }

    @PostMapping
    public ResponseEntity<SimulationResult> startSimulation(@RequestBody SimulationConfig config) {
        if (config.getProcesses() == null || config.getProcesses().isEmpty()) {
            return ResponseEntity.badRequest().build();
        }
        SimulationResult result = simulationEngine.start(config);
        return ResponseEntity.status(HttpStatus.CREATED).body(result);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> stopSimulation(@PathVariable String id) {
        simulationEngine.stop(id);
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/{id}/speed")
    public ResponseEntity<Void> setSpeed(@PathVariable String id,
                                          @RequestBody Map<String, Integer> body) {
        Integer ms = body.get("tickIntervalMs");
        if (ms == null || ms <= 0) return ResponseEntity.badRequest().build();
        simulationEngine.setSpeed(id, ms);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/{id}/status")
    public ResponseEntity<Map<String, Object>> getStatus(@PathVariable String id) {
        SimulationState state = simulationEngine.getStatus(id);
        if (state == null) return ResponseEntity.notFound().build();
        SimulationResult result = simulationEngine.getResult(id);
        return ResponseEntity.ok(Map.of(
                "simulationId", id,
                "state", state.name(),
                "currentTick", result != null ? result.getCurrentTick() : 0
        ));
    }

    @GetMapping("/{id}/result")
    public ResponseEntity<SimulationResult> getResult(@PathVariable String id) {
        SimulationResult result = simulationEngine.getResult(id);
        if (result == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(result);
    }

    @GetMapping("/{id}/snapshots")
    public ResponseEntity<List<TickSnapshot>> getSnapshots(
            @PathVariable String id,
            @RequestParam AlgorithmType algorithm,
            @RequestParam(defaultValue = "0") int from,
            @RequestParam(defaultValue = "9999") int to) {
        List<TickSnapshot> snapshots = simulationEngine.getSnapshots(id, algorithm, from, to);
        return ResponseEntity.ok(snapshots);
    }
}
