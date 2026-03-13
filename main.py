import yaml
import time
import random 
import pprint as pp


def get_routine():
    with open("exercises.yml") as f:
        exercises = yaml.safe_load(f)

        routine = []
        start_exercise_type_strength = random.random() < 0.5

        for group in exercises["groups"]:
            
            if start_exercise_type_strength:
                routine += [group["exercises"]["strength"][0]["name"]]
            else:
                routine += [group["exercises"]["stability"][0]["name"]]
            
            start_exercise_type_strength = not start_exercise_type_strength

    return routine

def perform_routine(
    routine: list(str),
    start_duration=3,
    movement_duration=5,
    rest_duration=4,
    rotations=2,
):

    message=f"Get Ready - Starting with {routine[0]}!"
    print(message)

    time_remaining = start_duration
    for _ in range(start_duration):
        print(time_remaining)
        time_remaining-=1
        time.sleep(1)

    for rotation in range(rotations):

        for i, movement in enumerate(routine):

            message = f"{movement} - Go!"
            print(message)

            time_remaining = movement_duration
            for _ in range(movement_duration):
                print(time_remaining)
                time_remaining-=1
                time.sleep(1)

            next_exercise = routine[i + 1] if i + 1 < len(routine) else "Finished!"
            message = f"Rest - next up: {next_exercise}"
            print(message)

            time_remaining = rest_duration
            for _ in range(rest_duration):
                print(time_remaining)
                time_remaining-=1
                time.sleep(1)


if __name__ == "__main__":
    perform_routine(get_routine()[:2])