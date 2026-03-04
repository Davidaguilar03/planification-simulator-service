package co.edu.uptc.planification_model_service.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProcessDefinition {
    private String id;
    private String name;
    private int arrivalTime;
    private int burstTime;
    private int priority;
    private Integer batchGroup;
}

